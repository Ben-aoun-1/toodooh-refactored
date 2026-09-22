import { eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import { type NewUser, notifications, recharges, users } from '../src/db/schema.js';
import { adminRechargesRoutes } from '../src/routes/admin-recharges.js';
import { apiRoutes } from '../src/routes/index.js';
import { rechargesRoutes } from '../src/routes/recharges.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// RECH-ADM1 — atomicity probe: arming the bomb makes the confirm/reject label read throw. The read
// belongs to the decision's transaction, so a failed read rolls the decision back — a 500 can
// never stand on an already-committed (credited/cancelled) recharge.
const labelBomb = vi.hoisted(() => ({ armed: false }));
vi.mock('../src/lib/recharges.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/recharges.js')>();
  const rechargeAdvertiserById: typeof actual.rechargeAdvertiserById = async (...args) => {
    if (labelBomb.armed) throw new Error('label read bomb');
    return actual.rechargeAdvertiserById(...args);
  };
  return { ...actual, rechargeAdvertiserById };
});

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
      email: `adminrch${seq}@example.com`,
      contactName: `User ${seq}`,
      role: 'advertiser',
      status: 'approved',
      ...values,
    })
    .returning();
  return u?.id ?? '';
};

const seedRecharge = async (
  advertiserId: string,
  amountTnd: string,
  reference: string,
  status: 'pending' | 'confirmed' | 'rejected' = 'pending',
): Promise<string> => {
  const [r] = await db
    .insert(recharges)
    .values({ advertiserId, amountTnd, reference, status })
    .returning();
  return r?.id ?? '';
};

describe('admin recharge moderation + crediting (real Postgres)', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    await resetAuthTables();
    app = buildApp();
    await app.register(adminRechargesRoutes);
    await app.register(rechargesRoutes); // for the /api/wallet/balance crediting assertion
    await app.ready();
  });

  afterEach(async () => {
    labelBomb.armed = false;
    await app.close();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await sql.end();
  });

  // ── GET /api/admin/recharges ────────────────────────────────────────────────
  it('lists the recharge queue (newest first) and filters by status', async () => {
    const adv = await seedUser();
    await seedRecharge(adv, '10.00', 'FCT-Q0000001', 'pending');
    await seedRecharge(adv, '20.00', 'FCT-Q0000002', 'confirmed');
    const admin = await seedUser({ role: 'admin', email: 'queueadmin@example.com' });
    mockSession(admin);
    const all = await app.inject({ method: 'GET', url: '/api/admin/recharges' });
    expect(all.statusCode).toBe(200);
    expect((all.json() as unknown[]).length).toBe(2);
    const pending = await app.inject({ method: 'GET', url: '/api/admin/recharges?status=pending' });
    expect((pending.json() as { reference: string }[]).map((r) => r.reference)).toEqual([
      'FCT-Q0000001',
    ]);
  });

  // RECH-ADM1 (T3) — every row carries ADM-FIX1's ONE label + the email, whatever the
  // screencaster's account status. The page used to name advertisers from the APPROVED users
  // only, so a pending/rejected/banned screencaster's recharge printed a raw uuid.
  it('names every row with the ADM-FIX1 label + email — non-approved screencasters included', async () => {
    const approved = await seedUser({ businessName: 'Café Central', email: 'central@example.com' });
    const pendingAcc = await seedUser({
      status: 'pending',
      businessName: '  ',
      contactName: 'Salma Ben Ali',
      email: 'salma@example.com',
    });
    const banned = await seedUser({
      status: 'banned',
      businessName: null,
      contactName: ' ',
      email: 'banned@example.com',
    });
    await seedRecharge(approved, '10.00', 'FCT-N0000001');
    await seedRecharge(pendingAcc, '20.00', 'FCT-N0000002');
    await seedRecharge(banned, '30.00', 'FCT-N0000003');
    const admin = await seedUser({ role: 'admin', email: 'namesadmin@example.com' });
    mockSession(admin);
    const res = await app.inject({ method: 'GET', url: '/api/admin/recharges' });
    expect(res.statusCode).toBe(200);
    const byRef = new Map(
      (
        res.json() as {
          reference: string;
          advertiser_id: string;
          advertiser_label: string;
          advertiser_email: string;
        }[]
      ).map((r) => [r.reference, r]),
    );
    expect(byRef.get('FCT-N0000001')).toMatchObject({
      advertiser_id: approved,
      advertiser_label: 'Café Central',
      advertiser_email: 'central@example.com',
    });
    expect(byRef.get('FCT-N0000002')).toMatchObject({
      advertiser_id: pendingAcc,
      advertiser_label: 'Salma Ben Ali',
      advertiser_email: 'salma@example.com',
    });
    expect(byRef.get('FCT-N0000003')).toMatchObject({
      advertiser_id: banned,
      advertiser_label: 'banned@example.com',
      advertiser_email: 'banned@example.com',
    });
  });

  it('the confirm and reject responses carry the same label + email', async () => {
    const adv = await seedUser({
      status: 'rejected',
      businessName: 'Pharmacie Nour',
      email: 'nour@example.com',
    });
    const toConfirm = await seedRecharge(adv, '40.00', 'FCT-N0000004');
    const toReject = await seedRecharge(adv, '50.00', 'FCT-N0000005');
    const admin = await seedUser({ role: 'admin', email: 'namesadmin2@example.com' });
    mockSession(admin);
    const confirmed = await app.inject({
      method: 'POST',
      url: `/api/admin/recharges/${toConfirm}/confirm`,
    });
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.json()).toMatchObject({
      advertiser_label: 'Pharmacie Nour',
      advertiser_email: 'nour@example.com',
    });
    const rejected = await app.inject({
      method: 'POST',
      url: `/api/admin/recharges/${toReject}/reject`,
      payload: { reason: 'virement introuvable' },
    });
    expect(rejected.statusCode).toBe(200);
    expect(rejected.json()).toMatchObject({
      advertiser_label: 'Pharmacie Nour',
      advertiser_email: 'nour@example.com',
    });
  });

  // RECH-ADM1 — the label read can no longer 500 an already-committed decision: it runs inside
  // the decision's transaction, so when it fails NOTHING is committed (no credit, no notice) and
  // the admin's retry succeeds.
  it('a failed label read on confirm rolls the decision back — a 500 never stands on a credited recharge', async () => {
    const adv = await seedUser({ businessName: 'Café Atomique' });
    const id = await seedRecharge(adv, '90.00', 'FCT-A0000001');
    const admin = await seedUser({ role: 'admin', email: 'atomadmin@example.com' });
    mockSession(admin);
    labelBomb.armed = true;
    const failed = await app.inject({ method: 'POST', url: `/api/admin/recharges/${id}/confirm` });
    expect(failed.statusCode).toBe(500);
    const [row] = await db.select().from(recharges).where(eq(recharges.id, id));
    expect(row).toMatchObject({ status: 'pending', confirmedAt: null, confirmedBy: null });
    expect(await db.select().from(notifications).where(eq(notifications.userId, adv))).toEqual([]);
    labelBomb.armed = false;
    const retried = await app.inject({ method: 'POST', url: `/api/admin/recharges/${id}/confirm` });
    expect(retried.statusCode).toBe(200);
    expect(retried.json()).toMatchObject({
      status: 'confirmed',
      advertiser_label: 'Café Atomique',
    });
    mockSession(adv, 'advertiser');
    expect((await app.inject({ method: 'GET', url: '/api/wallet/balance' })).json()).toMatchObject({
      balance_tnd: 90,
    });
  });

  it('a failed label read on reject rolls the decision back — the recharge stays decidable', async () => {
    const adv = await seedUser({ businessName: 'Pharmacie Atomique' });
    const id = await seedRecharge(adv, '70.00', 'FCT-A0000002');
    const admin = await seedUser({ role: 'admin', email: 'atomadmin2@example.com' });
    mockSession(admin);
    labelBomb.armed = true;
    const failed = await app.inject({
      method: 'POST',
      url: `/api/admin/recharges/${id}/reject`,
      payload: { reason: 'virement introuvable' },
    });
    expect(failed.statusCode).toBe(500);
    const [row] = await db.select().from(recharges).where(eq(recharges.id, id));
    expect(row).toMatchObject({ status: 'pending', rejectReason: null, cancelledAt: null });
    expect(await db.select().from(notifications).where(eq(notifications.userId, adv))).toEqual([]);
    labelBomb.armed = false;
    const retried = await app.inject({
      method: 'POST',
      url: `/api/admin/recharges/${id}/reject`,
      payload: { reason: 'virement introuvable' },
    });
    expect(retried.statusCode).toBe(200);
    expect(retried.json()).toMatchObject({
      status: 'rejected',
      advertiser_label: 'Pharmacie Atomique',
    });
  });

  // ── confirm ──────────────────────────────────────────────────────────────────
  it('confirm credits the wallet balance (pending → confirmed, audit stamped)', async () => {
    const adv = await seedUser();
    const id = await seedRecharge(adv, '250.00', 'FCT-C0000001', 'pending');
    const admin = await seedUser({ role: 'admin', email: 'confadmin@example.com' });
    mockSession(admin);
    const res = await app.inject({ method: 'POST', url: `/api/admin/recharges/${id}/confirm` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'confirmed', confirmed_by: admin });
    const [row] = await db.select().from(recharges).where(eq(recharges.id, id));
    expect(row?.confirmedAt).not.toBeNull();
    // Balance (as the advertiser) now reflects the credit.
    mockSession(adv, 'advertiser');
    const bal = await app.inject({ method: 'GET', url: '/api/wallet/balance' });
    expect(bal.json()).toMatchObject({ balance_tnd: 250, credited_tnd: 250 });
  });

  it('re-confirming is idempotent (409) and never double-credits', async () => {
    const adv = await seedUser();
    const id = await seedRecharge(adv, '80.00', 'FCT-C0000002', 'pending');
    const admin = await seedUser({ role: 'admin', email: 'idemadmin@example.com' });
    mockSession(admin);
    expect(
      (await app.inject({ method: 'POST', url: `/api/admin/recharges/${id}/confirm` })).statusCode,
    ).toBe(200);
    const second = await app.inject({ method: 'POST', url: `/api/admin/recharges/${id}/confirm` });
    expect(second.statusCode).toBe(409);
    expect((second.json() as { currentStatus: string }).currentStatus).toBe('confirmed');
    mockSession(adv, 'advertiser');
    expect((await app.inject({ method: 'GET', url: '/api/wallet/balance' })).json()).toMatchObject({
      balance_tnd: 80,
    });
  });

  it('confirming a rejected recharge conflicts (409)', async () => {
    const adv = await seedUser();
    const id = await seedRecharge(adv, '30.00', 'FCT-C0000003', 'rejected');
    const admin = await seedUser({ role: 'admin', email: 'rejadmin@example.com' });
    mockSession(admin);
    const res = await app.inject({ method: 'POST', url: `/api/admin/recharges/${id}/confirm` });
    expect(res.statusCode).toBe(409);
  });

  it('confirm 404s an unknown recharge', async () => {
    const admin = await seedUser({ role: 'admin', email: 'nf404@example.com' });
    mockSession(admin);
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/recharges/00000000-0000-0000-0000-000000000000/confirm',
    });
    expect(res.statusCode).toBe(404);
  });

  // ── reject ────────────────────────────────────────────────────────────────────
  it('reject sets status + reason (pending → rejected)', async () => {
    const adv = await seedUser();
    const id = await seedRecharge(adv, '60.00', 'FCT-R0000001', 'pending');
    const admin = await seedUser({ role: 'admin', email: 'rj1admin@example.com' });
    mockSession(admin);
    const res = await app.inject({
      method: 'POST',
      url: `/api/admin/recharges/${id}/reject`,
      payload: { reason: 'transfer never arrived' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      status: 'rejected',
      reject_reason: 'transfer never arrived',
    });
    // A rejected recharge does not credit the balance.
    mockSession(adv, 'advertiser');
    expect((await app.inject({ method: 'GET', url: '/api/wallet/balance' })).json()).toMatchObject({
      balance_tnd: 0,
    });
  });

  it('reject requires a non-empty reason (400)', async () => {
    const adv = await seedUser();
    const id = await seedRecharge(adv, '60.00', 'FCT-R0000002', 'pending');
    const admin = await seedUser({ role: 'admin', email: 'rj2admin@example.com' });
    mockSession(admin);
    expect(
      (await app.inject({ method: 'POST', url: `/api/admin/recharges/${id}/reject`, payload: {} }))
        .statusCode,
    ).toBe(400);
  });

  // ── authz ─────────────────────────────────────────────────────────────────────
  it('forbids a non-admin from the admin surface (403)', async () => {
    const adv = await seedUser();
    const id = await seedRecharge(adv, '10.00', 'FCT-Z0000001', 'pending');
    mockSession(adv, 'advertiser');
    expect((await app.inject({ method: 'GET', url: '/api/admin/recharges' })).statusCode).toBe(403);
    expect(
      (await app.inject({ method: 'POST', url: `/api/admin/recharges/${id}/confirm` })).statusCode,
    ).toBe(403);
  });

  // ── apiRoutes wiring ─────────────────────────────────────────────────────────
  it('is wired into the apiRoutes aggregate', async () => {
    const admin = await seedUser({ role: 'admin', email: 'wireadmin@example.com' });
    mockSession(admin);
    const aggregate = buildApp();
    await aggregate.register(apiRoutes);
    await aggregate.ready();
    try {
      expect(
        (await aggregate.inject({ method: 'GET', url: '/api/admin/recharges' })).statusCode,
      ).toBe(200);
    } finally {
      await aggregate.close();
    }
  });
});
