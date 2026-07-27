import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import {
  type NewUser,
  notifications,
  recharges,
  users,
  walletAdjustments,
} from '../src/db/schema.js';
import { makeReference } from '../src/lib/recharges.js';
import { isValidAdjustmentAmount, signedTnd } from '../src/lib/wallet-adjustments.js';
import { adminWalletRoutes } from '../src/routes/admin-wallet.js';
import { rechargesRoutes } from '../src/routes/recharges.js';
import { walletDocumentsRoutes } from '../src/routes/wallet-documents.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// FCT2 (US-FCT-9) — the admin wallet adjustment: SIGNED, ALWAYS audited (reason NOT NULL),
// ALWAYS notified, and joining walletBalance as its third SUM term WITHOUT touching the
// credited/debited semantics (the funded gates' read-only posture). Real Postgres.

type GetSessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;

const buildApp = () => Fastify({ logger: false });

const mockSession = (userId: string, role = 'admin', status = 'approved'): void => {
  vi.spyOn(auth.api, 'getSession').mockResolvedValue({
    session: {},
    user: { id: userId, role, status },
  } as unknown as GetSessionResult);
};

let seq = 0;
const seedUser = async (values: Partial<NewUser> = {}): Promise<string> => {
  seq += 1;
  const [u] = await db
    .insert(users)
    .values({
      email: `wadj${seq}@example.com`,
      contactName: `User ${seq}`,
      role: 'advertiser',
      status: 'approved',
      ...values,
    })
    .returning();
  return u?.id ?? '';
};

describe('signed amount rules (pure)', () => {
  it('accepts signed 2-decimal non-zero amounts within the sanity bound', () => {
    expect(isValidAdjustmentAmount(150.5)).toBe(true);
    expect(isValidAdjustmentAmount(-30.25)).toBe(true);
    expect(isValidAdjustmentAmount(0)).toBe(false);
    expect(isValidAdjustmentAmount(10.123)).toBe(false);
    expect(isValidAdjustmentAmount(1_000_001)).toBe(false);
    expect(isValidAdjustmentAmount(-1_000_001)).toBe(false);
    expect(isValidAdjustmentAmount(Number.NaN)).toBe(false);
  });

  it('signedTnd renders the chartered ± display', () => {
    expect(signedTnd(150.5)).toBe('+150.50');
    expect(signedTnd(-30.25)).toBe('−30.25');
  });
});

describe('wallet adjustments (admin + balance seam, real Postgres)', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    await resetAuthTables();
    app = buildApp();
    await app.register(adminWalletRoutes);
    await app.register(rechargesRoutes);
    await app.register(walletDocumentsRoutes);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await sql.end();
  });

  const adjust = (id: string, payload: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: `/api/admin/advertisers/${id}/wallet-adjustment`, payload });
  const auditFor = (id: string) =>
    app.inject({ method: 'GET', url: `/api/admin/advertisers/${id}/wallet-adjustments` });

  it('adjusts (+): 201 audit view, immutable row with the admin id, French notification with the signed amount + reason', async () => {
    const advertiser = await seedUser();
    const admin = await seedUser({ role: 'admin' });
    mockSession(admin);

    const res = await adjust(advertiser, { amount_tnd: 150.5, reason: 'Geste commercial' });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      amount_tnd: 150.5,
      reason: 'Geste commercial',
      advertiser_id: advertiser,
      admin_id: admin,
    });

    const rows = await db
      .select()
      .from(walletAdjustments)
      .where(eq(walletAdjustments.advertiserId, advertiser));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.amountTnd).toBe('150.50');

    const notifs = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, advertiser));
    expect(notifs).toHaveLength(1);
    expect(notifs[0]).toMatchObject({
      type: 'wallet_adjustment',
      title: 'Ajustement de votre solde',
    });
    expect(notifs[0]?.body).toBe('Ajustement de votre solde : +150.50 TND — Geste commercial');
  });

  it('the balance seam: credited/debited stay UNTOUCHED, adjustments ride the third term (signed)', async () => {
    const advertiser = await seedUser();
    const admin = await seedUser({ role: 'admin' });
    const rechargeId = randomUUID();
    await db.insert(recharges).values({
      id: rechargeId,
      advertiserId: advertiser,
      amountTnd: '100.00',
      reference: makeReference(rechargeId),
      status: 'confirmed',
    });

    mockSession(admin);
    expect(
      (await adjust(advertiser, { amount_tnd: -30.25, reason: 'Trop-perçu' })).statusCode,
    ).toBe(201);
    expect((await adjust(advertiser, { amount_tnd: 5, reason: 'Correction' })).statusCode).toBe(
      201,
    );

    mockSession(advertiser, 'advertiser');
    const balance = (await app.inject({ method: 'GET', url: '/api/wallet/balance' })).json();
    // The reservation-untouched pin: credited is STILL the recharge SUM, debited STILL the
    // reconciliation SUM (0 here) — adjustments are their own separate term.
    expect(balance).toEqual({
      balance_tnd: 74.75,
      credited_tnd: 100,
      debited_tnd: 0,
      adjustments_tnd: -25.25,
      currency: 'TND',
    });
  });

  it('a negative adjustment can drive the balance negative (admin judgement — no clamp)', async () => {
    const advertiser = await seedUser();
    const admin = await seedUser({ role: 'admin' });
    mockSession(admin);
    await adjust(advertiser, { amount_tnd: -40, reason: 'Annulation de crédit' });
    mockSession(advertiser, 'advertiser');
    const balance = (await app.inject({ method: 'GET', url: '/api/wallet/balance' })).json() as {
      balance_tnd: number;
    };
    expect(balance.balance_tnd).toBe(-40);
  });

  it('no reason → no adjustment (400, nothing written, nobody notified)', async () => {
    const advertiser = await seedUser();
    const admin = await seedUser({ role: 'admin' });
    mockSession(admin);
    expect((await adjust(advertiser, { amount_tnd: 50 })).statusCode).toBe(400);
    expect((await adjust(advertiser, { amount_tnd: 50, reason: '   ' })).statusCode).toBe(400);
    expect(await db.$count(walletAdjustments)).toBe(0);
    expect(await db.$count(notifications)).toBe(0);
  });

  it('amount matrix: zero, >2 decimals and out-of-bound are 400s', async () => {
    const advertiser = await seedUser();
    const admin = await seedUser({ role: 'admin' });
    mockSession(admin);
    for (const amount of [0, 10.123, 1_000_001, -1_000_001]) {
      expect((await adjust(advertiser, { amount_tnd: amount, reason: 'x' })).statusCode).toBe(400);
    }
    expect(await db.$count(walletAdjustments)).toBe(0);
  });

  it('a missing user and a NON-advertiser target are one identical 404', async () => {
    const owner = await seedUser({ role: 'individual_owner' });
    const admin = await seedUser({ role: 'admin' });
    mockSession(admin);
    const missing = await adjust(randomUUID(), { amount_tnd: 10, reason: 'x' });
    const wrongRole = await adjust(owner, { amount_tnd: 10, reason: 'x' });
    expect(missing.statusCode).toBe(404);
    expect(wrongRole.body).toBe(missing.body);
  });

  it('guards: 401 without a session, 403 for a non-admin, 400 on a bad uuid', async () => {
    const advertiser = await seedUser();
    vi.spyOn(auth.api, 'getSession').mockResolvedValue(null as unknown as GetSessionResult);
    expect((await adjust(advertiser, { amount_tnd: 10, reason: 'x' })).statusCode).toBe(401);
    mockSession(advertiser, 'advertiser');
    expect((await adjust(advertiser, { amount_tnd: 10, reason: 'x' })).statusCode).toBe(403);
    const admin = await seedUser({ role: 'admin' });
    mockSession(admin);
    expect((await adjust('not-a-uuid', { amount_tnd: 10, reason: 'x' })).statusCode).toBe(400);
  });

  it('the audit trail: admin GET newest first with admin ids; the screencaster GET hides them', async () => {
    const advertiser = await seedUser();
    const admin = await seedUser({ role: 'admin' });
    mockSession(admin);
    await adjust(advertiser, { amount_tnd: 10, reason: 'Premier' });
    await adjust(advertiser, { amount_tnd: -5, reason: 'Second' });

    const audit = (await auditFor(advertiser)).json() as Record<string, unknown>[];
    expect(audit).toHaveLength(2);
    expect(audit[0]).toMatchObject({ reason: 'Second', admin_id: admin });

    mockSession(advertiser, 'advertiser');
    const mine = (
      await app.inject({ method: 'GET', url: '/api/wallet/adjustments' })
    ).json() as Record<string, unknown>[];
    expect(mine).toHaveLength(2);
    expect(mine[0]).toMatchObject({ amount_tnd: -5, reason: 'Second' });
    expect(mine[0]).not.toHaveProperty('admin_id');
  });
});
