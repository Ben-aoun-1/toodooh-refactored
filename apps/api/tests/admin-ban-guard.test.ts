import { eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import { type NewUser, users } from '../src/db/schema.js';
import { adminRoutes } from '../src/routes/admin.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// ADM-2 — POST /api/admin/users/:id/ban is adminGuard, but a STAFF target (role admin/superadmin)
// now requires a SUPERADMIN actor: the UI only hid the button; the route let any admin ban a peer
// admin or the superadmin by direct call. End-user bans are unchanged. Integration — real
// Postgres; requireAuth's getSession is mocked (its behavior lives in require-auth.test.ts).
vi.mock('nodemailer', () => ({
  default: { createTransport: vi.fn(() => ({ sendMail: vi.fn() })) },
}));

type GetSessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;

const buildApp = () => Fastify({ logger: false });

const mockSession = (userId: string, role: string): void => {
  vi.spyOn(auth.api, 'getSession').mockResolvedValue({
    session: {},
    user: { id: userId, role, status: 'approved' },
  } as unknown as GetSessionResult);
};

let seq = 0;
const seedUser = async (values: Partial<NewUser> = {}): Promise<string> => {
  seq += 1;
  const [u] = await db
    .insert(users)
    .values({
      email: `banguard${seq}@example.com`,
      contactName: `User ${seq}`,
      status: 'approved',
      ...values,
    })
    .returning();
  return u?.id ?? '';
};

const statusOf = async (id: string): Promise<string | undefined> => {
  const [row] = await db.select({ status: users.status }).from(users).where(eq(users.id, id));
  return row?.status;
};

describe('POST /api/admin/users/:id/ban — staff-target guard (ADM-2, real Postgres)', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    await resetAuthTables();
    app = buildApp();
    await app.register(adminRoutes);
    await app.ready();
  });
  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });
  afterAll(async () => {
    await sql.end();
  });

  const ban = (id: string) =>
    app.inject({
      method: 'POST',
      url: `/api/admin/users/${id}/ban`,
      payload: { notes: 'fraude constatée' },
    });

  it('a plain admin still bans an END-USER (unchanged)', async () => {
    const adminId = await seedUser({ role: 'admin' });
    mockSession(adminId, 'admin');
    const targetId = await seedUser({ role: 'advertiser' });

    const res = await ban(targetId);
    expect(res.statusCode).toBe(200);
    expect(await statusOf(targetId)).toBe('banned');
  });

  it('403 when a plain admin targets an ADMIN — the row is untouched', async () => {
    const adminId = await seedUser({ role: 'admin' });
    mockSession(adminId, 'admin');
    const peerId = await seedUser({ role: 'admin' });

    const res = await ban(peerId);
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: 'FORBIDDEN' });
    expect(await statusOf(peerId)).toBe('approved');
  });

  it('403 when a plain admin targets the SUPERADMIN — the row is untouched', async () => {
    const adminId = await seedUser({ role: 'admin' });
    mockSession(adminId, 'admin');
    const superId = await seedUser({ role: 'superadmin' });

    const res = await ban(superId);
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: 'FORBIDDEN' });
    expect(await statusOf(superId)).toBe('approved');
  });

  it('the SUPERADMIN still bans an admin (the /admin-management deactivate path)', async () => {
    const superId = await seedUser({ role: 'superadmin' });
    mockSession(superId, 'superadmin');
    const targetId = await seedUser({ role: 'admin' });

    const res = await ban(targetId);
    expect(res.statusCode).toBe(200);
    expect(await statusOf(targetId)).toBe('banned');
  });

  it('privilege outranks state: a plain admin gets 403 on an ALREADY-BANNED admin, not the 409', async () => {
    const adminId = await seedUser({ role: 'admin' });
    mockSession(adminId, 'admin');
    const bannedPeer = await seedUser({ role: 'admin', status: 'banned' });

    const res = await ban(bannedPeer);
    expect(res.statusCode).toBe(403);
  });
});
