import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import { type NewUser, recharges, users } from '../src/db/schema.js';
import { apiRoutes } from '../src/routes/index.js';
import { rechargesRoutes } from '../src/routes/recharges.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// Integration suite — real Postgres (DATABASE_URL). getSession is mocked to drive the session
// identity. resetAuthTables TRUNCATE ... CASCADE wipes recharges via the advertiser_id FK.
type GetSessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;

const buildApp = () => Fastify({ logger: false });

const mockSession = (userId: string, role = 'advertiser', status = 'approved'): void => {
  vi.spyOn(auth.api, 'getSession').mockResolvedValue({
    session: {},
    user: { id: userId, role, status },
  } as unknown as GetSessionResult);
};

const mockNoSession = (): void => {
  vi.spyOn(auth.api, 'getSession').mockResolvedValue(null as unknown as GetSessionResult);
};

let seq = 0;
const seedUser = async (values: Partial<NewUser> = {}): Promise<string> => {
  seq += 1;
  const [u] = await db
    .insert(users)
    .values({
      email: `recharge${seq}@example.com`,
      contactName: `User ${seq}`,
      role: 'advertiser',
      status: 'approved',
      ...values,
    })
    .returning();
  return u?.id ?? '';
};

describe('recharges + wallet (advertiser, real Postgres)', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    await resetAuthTables();
    app = buildApp();
    await app.register(rechargesRoutes);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await sql.end();
  });

  // ── POST /api/recharges — RETIRED by FCT1 ──────────────────────────────────
  it('POST /api/recharges is retired (410, French reason, no row)', async () => {
    const me = await seedUser();
    mockSession(me);
    const res = await app.inject({
      method: 'POST',
      url: '/api/recharges',
      payload: { amount: 150.5 },
    });
    expect(res.statusCode).toBe(410);
    const body = res.json() as { error: string; message: string };
    expect(body.error).toBe('GONE');
    expect(body.message).toContain("n'est plus disponible");
    expect(await db.$count(recharges)).toBe(0);
  });

  it('requires authentication (401)', async () => {
    mockNoSession();
    const res = await app.inject({
      method: 'POST',
      url: '/api/recharges',
      payload: { amount: 50 },
    });
    expect(res.statusCode).toBe(401);
  });

  it('forbids a non-advertiser (403)', async () => {
    const owner = await seedUser({ role: 'individual_owner' });
    mockSession(owner, 'individual_owner');
    const res = await app.inject({
      method: 'POST',
      url: '/api/recharges',
      payload: { amount: 50 },
    });
    expect(res.statusCode).toBe(403);
  });

  // ── GET /api/recharges/mine ─────────────────────────────────────────────────
  it('GET /mine lists only the caller’s recharges, newest first, and filters by status', async () => {
    const me = await seedUser();
    const other = await seedUser();
    await db.insert(recharges).values([
      { advertiserId: me, amountTnd: '10.00', reference: 'FCT-AAAA0001', status: 'pending' },
      { advertiserId: me, amountTnd: '20.00', reference: 'FCT-AAAA0002', status: 'confirmed' },
      { advertiserId: other, amountTnd: '99.00', reference: 'FCT-BBBB0001', status: 'pending' },
    ]);
    mockSession(me);
    const all = await app.inject({ method: 'GET', url: '/api/recharges/mine' });
    expect(all.statusCode).toBe(200);
    expect((all.json() as unknown[]).length).toBe(2);
    const pending = await app.inject({ method: 'GET', url: '/api/recharges/mine?status=pending' });
    expect((pending.json() as { reference: string }[]).map((r) => r.reference)).toEqual([
      'FCT-AAAA0001',
    ]);
  });

  // ── GET /api/wallet/balance (DERIVED — confirmed only) ──────────────────────
  it('balance is 0 with no confirmed recharges', async () => {
    const me = await seedUser();
    await db.insert(recharges).values({
      advertiserId: me,
      amountTnd: '40.00',
      reference: 'FCT-CCCC0001',
      status: 'pending',
    });
    mockSession(me);
    const res = await app.inject({ method: 'GET', url: '/api/wallet/balance' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ balance_tnd: 0, credited_tnd: 0, debited_tnd: 0 });
  });

  it('balance reflects ONLY confirmed recharges (sum of confirmed amounts)', async () => {
    const me = await seedUser();
    await db.insert(recharges).values([
      { advertiserId: me, amountTnd: '100.00', reference: 'FCT-DDDD0001', status: 'confirmed' },
      { advertiserId: me, amountTnd: '50.50', reference: 'FCT-DDDD0002', status: 'confirmed' },
      { advertiserId: me, amountTnd: '999.00', reference: 'FCT-DDDD0003', status: 'pending' },
      { advertiserId: me, amountTnd: '999.00', reference: 'FCT-DDDD0004', status: 'rejected' },
    ]);
    mockSession(me);
    const res = await app.inject({ method: 'GET', url: '/api/wallet/balance' });
    expect(res.json()).toMatchObject({ balance_tnd: 150.5, credited_tnd: 150.5, debited_tnd: 0 });
  });

  // ── apiRoutes wiring ─────────────────────────────────────────────────────────
  it('is wired into the apiRoutes aggregate', async () => {
    const me = await seedUser();
    mockSession(me);
    const aggregate = buildApp();
    await aggregate.register(apiRoutes);
    await aggregate.ready();
    try {
      expect(
        (await aggregate.inject({ method: 'GET', url: '/api/wallet/balance' })).statusCode,
      ).toBe(200);
    } finally {
      await aggregate.close();
    }
  });
});
