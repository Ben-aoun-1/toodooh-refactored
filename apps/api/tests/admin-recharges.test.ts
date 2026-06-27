import { eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import { type NewUser, recharges, users } from '../src/db/schema.js';
import { adminRechargesRoutes } from '../src/routes/admin-recharges.js';
import { apiRoutes } from '../src/routes/index.js';
import { rechargesRoutes } from '../src/routes/recharges.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

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
