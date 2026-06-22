import { eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import { type NewUser, screenhosts, users } from '../src/db/schema.js';
import { meRoutes } from '../src/routes/me.js';
import { profileRoutes } from '../src/routes/profile.js';
import { screenhostsRoutes } from '../src/routes/screenhosts.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// C7 — server-side account-status gate (requireActiveAccount) on the screenhost APP surface. The
// exposure: requireAuth attaches request.user.status but never gates, so a rejected owner with a
// still-valid session (reject does NOT revoke sessions, by design) could call the owner app surface
// directly, bypassing the FE redirect. This suite proves: rejected/banned → 403 on the screenhost
// routes, while the rejected RECOVERY surfaces (/api/me, resubmit, bank) stay 200, and the pending
// carve-out + approved are unaffected. request.user.status comes from getSession (mocked here).
type GetSessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;

const buildApp = () => Fastify({ logger: false });

const mockSession = (userId: string, status: string): void => {
  vi.spyOn(auth.api, 'getSession').mockResolvedValue({
    session: {},
    user: { id: userId, role: 'individual_owner', status },
  } as unknown as GetSessionResult);
};

let seq = 0;
const seedOwner = async (values: Partial<NewUser> = {}): Promise<string> => {
  seq += 1;
  const [u] = await db
    .insert(users)
    .values({
      email: `gate${seq}@example.com`,
      contactName: `Owner ${seq}`,
      role: 'individual_owner',
      status: 'approved',
      ...values,
    })
    .returning();
  return u?.id ?? '';
};

const seedScreenhost = async (ownerId: string): Promise<string> => {
  const [s] = await db.insert(screenhosts).values({ name: 'Café Gate', ownerId }).returning();
  return s?.id ?? '';
};

describe('account-status gate on the screenhost app surface (C7)', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    await resetAuthTables();
    app = buildApp();
    await app.register(screenhostsRoutes);
    await app.register(meRoutes);
    await app.register(profileRoutes);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await sql.end();
  });

  const getMine = () => app.inject({ method: 'GET', url: '/api/screenhosts/mine' });

  // ── rejected/banned → 403 on the screenhost app surface ─────────────────────
  it('rejected → 403 ACCOUNT_NOT_ACTIVE on GET /api/screenhosts/mine', async () => {
    const ownerId = await seedOwner({ status: 'rejected' });
    await seedScreenhost(ownerId);
    mockSession(ownerId, 'rejected');
    const res = await getMine();
    expect(res.statusCode).toBe(403);
    expect(res.json<{ error: string }>().error).toBe('ACCOUNT_NOT_ACTIVE');
  });

  it('rejected → 403 on PATCH /api/screenhosts/:id/wifi (handler never runs)', async () => {
    const ownerId = await seedOwner({ status: 'rejected' });
    const shId = await seedScreenhost(ownerId);
    mockSession(ownerId, 'rejected');
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/screenhosts/${shId}/wifi`,
      payload: { wifi_ssid: 'X' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json<{ error: string }>().error).toBe('ACCOUNT_NOT_ACTIVE');
  });

  it('banned → 403 on GET /api/screenhosts/mine (defensive; banned is normally sessionless)', async () => {
    const ownerId = await seedOwner({ status: 'banned' });
    mockSession(ownerId, 'banned');
    expect((await getMine()).statusCode).toBe(403);
  });

  // ── pending carve-out + approved → unaffected ───────────────────────────────
  it('pending → 200 on GET /api/screenhosts/mine (product carve-out, unchanged)', async () => {
    const ownerId = await seedOwner({ status: 'pending' });
    await seedScreenhost(ownerId);
    mockSession(ownerId, 'pending');
    expect((await getMine()).statusCode).toBe(200);
  });

  it('approved → 200 on GET /api/screenhosts/mine', async () => {
    const ownerId = await seedOwner({ status: 'approved' });
    await seedScreenhost(ownerId);
    mockSession(ownerId, 'approved');
    expect((await getMine()).statusCode).toBe(200);
  });

  // ── rejected RECOVERY surfaces are NOT gated (the C3b loop needs them) ───────
  it('rejected → 200 on GET /api/me (recovery — reads status, never gated)', async () => {
    const ownerId = await seedOwner({ status: 'rejected', validationNotes: 'CIN illisible' });
    mockSession(ownerId, 'rejected');
    const res = await app.inject({ method: 'GET', url: '/api/me' });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ user: { status: string } }>().user.status).toBe('rejected');
  });

  it('rejected → 200 on POST /api/profile/resubmit (recovery → pending)', async () => {
    const ownerId = await seedOwner({ status: 'rejected', validationNotes: 'CIN illisible' });
    mockSession(ownerId, 'rejected');
    const res = await app.inject({ method: 'POST', url: '/api/profile/resubmit' });
    expect(res.statusCode).toBe(200);
    const [row] = await db.select().from(users).where(eq(users.id, ownerId));
    expect(row?.status).toBe('pending'); // recovered
  });

  it('rejected → 200 on PATCH /api/profile/bank (recovery — fix the RIB)', async () => {
    const ownerId = await seedOwner({ status: 'rejected' });
    mockSession(ownerId, 'rejected');
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/profile/bank',
      payload: { bank_account_holder: 'Foulen Ben Foulen' },
    });
    expect(res.statusCode).toBe(200);
  });
});
