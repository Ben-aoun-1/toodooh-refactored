import { eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import { accounts, type NewUser, users } from '../src/db/schema.js';
import { adminAccountsRoutes } from '../src/routes/admin-accounts.js';
import { signinRoutes } from '../src/routes/signin.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// Integration suite — real Postgres (DATABASE_URL). requireAuth's getSession is mocked (its
// behavior lives in require-auth.test.ts); the route logic + the better-auth password round-trip
// (create hash → /api/signin verify) run against real rows. The actor superadmin is a real users
// row (validated_by self-FKs users.id), seeded per test.
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
    .values({ email: `actor${seq}@example.com`, contactName: `Actor ${seq}`, ...values })
    .returning();
  return u?.id ?? '';
};

const VALID = {
  email: 'agent1@example.com',
  password: 'agent-pass-1234', // 15 chars ≥ 12
  contact_name: 'Agent One',
  role: 'screenhost_agent',
};

describe('POST /api/admin/accounts (real Postgres)', () => {
  let app: ReturnType<typeof buildApp>;
  let superId: string;

  beforeEach(async () => {
    await resetAuthTables();
    superId = await seedUser({ role: 'superadmin', status: 'approved' });
    app = buildApp();
    await app.register(adminAccountsRoutes);
    await app.register(signinRoutes); // for the sign-in round-trip proof
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await sql.end();
  });

  const create = (body: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: '/api/admin/accounts', payload: body });

  it('superadmin creates a screenhost_agent → 201 verified+approved view', async () => {
    mockSession(superId);
    const res = await create(VALID);
    expect(res.statusCode).toBe(201);
    const body = res.json<{
      account: { role: string; status: string; email_verified: boolean; email: string };
    }>();
    expect(body.account.role).toBe('screenhost_agent');
    expect(body.account.status).toBe('approved');
    expect(body.account.email_verified).toBe(true);
    expect(body.account.email).toBe('agent1@example.com');
  });

  it('created account is verified + approved + has a credential account', async () => {
    mockSession(superId);
    await create(VALID);
    const [u] = await db.select().from(users).where(eq(users.email, 'agent1@example.com'));
    expect(u?.emailVerified).toBe(true);
    expect(u?.status).toBe('approved');
    expect(u?.role).toBe('screenhost_agent');
    expect(u?.validatedBy).toBe(superId);
    const a = await db
      .select()
      .from(accounts)
      .where(eq(accounts.userId, u?.id ?? ''));
    expect(a).toHaveLength(1);
    expect(a[0]?.providerId).toBe('credential');
    expect(a[0]?.password).toBeTruthy();
  });

  it('created account can sign in through /api/signin', async () => {
    mockSession(superId);
    expect((await create(VALID)).statusCode).toBe(201);
    const res = await app.inject({
      method: 'POST',
      url: '/api/signin',
      payload: { email: 'agent1@example.com', password: 'agent-pass-1234' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ user: { role: string; status: string } }>();
    expect(body.user.role).toBe('screenhost_agent');
    expect(body.user.status).toBe('approved');
  });

  it('non-superadmin (admin) → 403 FORBIDDEN', async () => {
    const adminId = await seedUser({ role: 'admin', status: 'approved' });
    mockSession(adminId, 'admin');
    const res = await create(VALID);
    expect(res.statusCode).toBe(403);
    expect(res.json<{ error: string }>().error).toBe('FORBIDDEN');
  });

  it('no session → 401', async () => {
    vi.spyOn(auth.api, 'getSession').mockResolvedValue(null);
    expect((await create(VALID)).statusCode).toBe(401);
  });

  it('duplicate email → 409 EMAIL_TAKEN', async () => {
    mockSession(superId);
    expect((await create(VALID)).statusCode).toBe(201);
    const res = await create({ ...VALID, role: 'admin' });
    expect(res.statusCode).toBe(409);
    expect(res.json<{ error: string }>().error).toBe('EMAIL_TAKEN');
  });

  it('role=superadmin (not creatable here) → 400', async () => {
    mockSession(superId);
    const res = await create({ ...VALID, role: 'superadmin' });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ fields: { field: string }[] }>().fields.some((f) => f.field === 'role')).toBe(
      true,
    );
  });

  it('role=advertiser (end-user role not creatable here) → 400', async () => {
    mockSession(superId);
    expect((await create({ ...VALID, role: 'advertiser' })).statusCode).toBe(400);
  });

  it('password < 12 → 400', async () => {
    mockSession(superId);
    const res = await create({ ...VALID, password: 'shortpwd' });
    expect(res.statusCode).toBe(400);
    expect(
      res.json<{ fields: { field: string }[] }>().fields.some((f) => f.field === 'password'),
    ).toBe(true);
  });

  it('missing password → 400', async () => {
    mockSession(superId);
    const noPw = { email: VALID.email, contact_name: VALID.contact_name, role: VALID.role };
    expect((await create(noPw)).statusCode).toBe(400);
  });
});
