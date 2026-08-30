import { eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import { type NewUser, sessions, users } from '../src/db/schema.js';
import { adminAccountsRoutes, splitContactName } from '../src/routes/admin-accounts.js';
import { adminRoutes } from '../src/routes/admin.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// ADM-ADM1 — the staff-account list + the ban/unban lifecycle the /admin-management page drives.
// Integration — real Postgres; requireAuth's getSession is mocked (its behavior lives in
// require-auth.test.ts). adminRoutes is registered too so the deactivate half (the EXISTING ban
// route) is exercised against the same rows as its new inverse.
vi.mock('nodemailer', () => ({
  default: { createTransport: vi.fn(() => ({ sendMail: vi.fn() })) },
}));

type GetSessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;

const buildApp = () => Fastify({ logger: false });

const mockSession = (userId: string, role = 'superadmin', status = 'approved'): void => {
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
      email: `staff${seq}@example.com`,
      contactName: `Staff ${seq}`,
      status: 'approved',
      ...values,
    })
    .returning();
  return u?.id ?? '';
};

interface AdminAccountView {
  id: string;
  email: string;
  contact_name: string;
  first_name: string;
  last_name: string;
  role: string;
  is_active: boolean;
  created_at: string;
}

describe('splitContactName', () => {
  it('splits on the first space; a mononym has an empty last name', () => {
    expect(splitContactName('Amine Ben Aoun')).toEqual({ first: 'Amine', last: 'Ben Aoun' });
    expect(splitContactName('  Mejri ')).toEqual({ first: 'Mejri', last: '' });
    expect(splitContactName('')).toEqual({ first: '', last: '' });
  });
});

describe('GET /api/admin/admins + POST /api/admin/users/:id/unban (real Postgres)', () => {
  let app: ReturnType<typeof buildApp>;
  let superId: string;

  beforeEach(async () => {
    await resetAuthTables();
    superId = await seedUser({
      role: 'superadmin',
      contactName: 'Root Super',
      createdAt: new Date('2026-01-01T00:00:00Z'),
    });
    app = buildApp();
    await app.register(adminAccountsRoutes);
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

  const listAdmins = () => app.inject({ method: 'GET', url: '/api/admin/admins' });
  const unban = (id: string) => app.inject({ method: 'POST', url: `/api/admin/users/${id}/unban` });
  const ban = (id: string, notes = 'Compte désactivé par le superadmin') =>
    app.inject({ method: 'POST', url: `/api/admin/users/${id}/ban`, payload: { notes } });

  it('403 for a plain admin on both routes (superadmin-only surface)', async () => {
    const adminId = await seedUser({ role: 'admin' });
    mockSession(adminId, 'admin');
    expect((await listAdmins()).statusCode).toBe(403);
    expect((await unban(adminId)).statusCode).toBe(403);
  });

  it('lists admin + superadmin rows only, newest first, with the name split and is_active', async () => {
    mockSession(superId);
    await seedUser({ role: 'advertiser', contactName: 'Not Staff' });
    await seedUser({ role: 'screenhost_agent', contactName: 'Agent Nope' });
    const adminId = await seedUser({
      role: 'admin',
      contactName: 'Amine Ben Aoun',
      createdAt: new Date('2026-02-01T00:00:00Z'),
    });
    const bannedId = await seedUser({
      role: 'admin',
      contactName: 'Mejri',
      status: 'banned',
      createdAt: new Date('2026-03-01T00:00:00Z'),
    });

    const res = await listAdmins();
    expect(res.statusCode).toBe(200);
    const { admins } = res.json() as { admins: AdminAccountView[] };
    expect(admins.map((a) => a.id)).toEqual([bannedId, adminId, superId]);
    expect(admins[0]).toMatchObject({
      contact_name: 'Mejri',
      first_name: 'Mejri',
      last_name: '',
      role: 'admin',
      is_active: false,
    });
    expect(admins[1]).toMatchObject({
      contact_name: 'Amine Ben Aoun',
      first_name: 'Amine',
      last_name: 'Ben Aoun',
      role: 'admin',
      is_active: true,
    });
    expect(admins[2]).toMatchObject({ role: 'superadmin', is_active: true });
    expect(admins[2]?.email).toMatch(/@example\.com$/);
  });

  it('ban (existing route) then unban round-trips a staff account', async () => {
    mockSession(superId);
    const adminId = await seedUser({ role: 'admin', contactName: 'Staff Two' });
    await db.insert(sessions).values({
      userId: adminId,
      token: 'tok-staff-two',
      expiresAt: new Date(Date.now() + 3_600_000),
    });

    const banned = await ban(adminId);
    expect(banned.statusCode).toBe(200);
    // The ban revoked the session; the list now reads the account as inactive.
    expect(await db.select().from(sessions).where(eq(sessions.userId, adminId))).toHaveLength(0);
    let { admins } = (await listAdmins()).json() as { admins: AdminAccountView[] };
    expect(admins.find((a) => a.id === adminId)?.is_active).toBe(false);

    const res = await unban(adminId);
    expect(res.statusCode).toBe(200);
    const { account } = res.json() as { account: AdminAccountView };
    expect(account).toMatchObject({ id: adminId, is_active: true, role: 'admin' });

    const [row] = await db.select().from(users).where(eq(users.id, adminId));
    expect(row?.status).toBe('approved');
    expect(row?.validatedBy).toBe(superId);
    expect(row?.validationNotes).toBeNull();
    ({ admins } = (await listAdmins()).json() as { admins: AdminAccountView[] });
    expect(admins.find((a) => a.id === adminId)?.is_active).toBe(true);
  });

  it('409 when the target is not banned', async () => {
    mockSession(superId);
    const adminId = await seedUser({ role: 'admin' });
    const res = await unban(adminId);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'CONFLICT', currentStatus: 'approved' });
  });

  it('409 NOT_ADMIN_ACCOUNT for a banned END-USER — those bans stay terminal', async () => {
    mockSession(superId);
    const ownerId = await seedUser({ role: 'fleet_owner', status: 'banned' });
    const res = await unban(ownerId);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'NOT_ADMIN_ACCOUNT' });
    const [row] = await db.select().from(users).where(eq(users.id, ownerId));
    expect(row?.status).toBe('banned');
  });

  it('404 on an unknown id, 400 on a malformed one', async () => {
    mockSession(superId);
    expect((await unban('00000000-0000-4000-8000-000000000000')).statusCode).toBe(404);
    expect((await unban('not-a-uuid')).statusCode).toBe(400);
  });
});
