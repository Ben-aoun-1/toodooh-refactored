import { eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth, emailSender } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import { accounts, agents, type NewUser, users, verifications } from '../src/db/schema.js';
import { adminAccountsRoutes } from '../src/routes/admin-accounts.js';
import { signinRoutes } from '../src/routes/signin.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// nodemailer mocked so the agent welcome email "sends" without a real SMTP connection (no external
// network in CI). Per-test the agent welcome send is exercised through emailSender.send.
const { sendMailMock } = vi.hoisted(() => ({
  sendMailMock: vi.fn().mockResolvedValue({ messageId: 'test-msg-id' }),
}));
vi.mock('nodemailer', () => ({
  default: { createTransport: vi.fn(() => ({ sendMail: sendMailMock })) },
}));

// wedooh hub provisioning (the agent push) is mocked so we assert the CALL-SITE decision (agents
// push, admin does not) without a real hub call. The sync env is UNSET in tests, so the real fn
// no-ops regardless — the mock isolates the route gate; the wire is covered in wedooh-sync.test.ts.
const pushAgentSpy = vi.hoisted(() =>
  vi.fn<(agent: unknown, logger: unknown) => Promise<void>>(() => Promise.resolve()),
);
vi.mock('../src/lib/wedooh-sync.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/wedooh-sync.js')>();
  return { ...actual, pushAgentToHub: pushAgentSpy };
});

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
    pushAgentSpy.mockReset();
    pushAgentSpy.mockResolvedValue(undefined);
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

  // SET-PW1 (Mejri 07/09 — her SECOND report of this). The « Définir mon mot de passe » button
  // used to point at a bare `${WEB_ORIGIN}/reset-password` with NO token: the invited agent had to
  // re-enter their email, and the creating admin clicking it in their own signed-in browser was
  // bounced by PublicRoute to the admin dashboard. It must now carry a real minted token whose
  // verification row belongs to the INVITED agent, and land on the token page.
  it('the welcome email carries a real reset token for the INVITED agent', async () => {
    sendMailMock.mockClear();
    mockSession(superId);
    await create(VALID);

    const sent = sendMailMock.mock.calls
      .map((call) => call[0] as { to: string; subject: string; html: string })
      .filter((mail) => mail.to === VALID.email);
    expect(sent).toHaveLength(1);
    const welcome = sent[0];
    if (!welcome) throw new Error('no welcome email captured');

    // The tokenized better-auth link, whose callback lands on the token page.
    const link = /\/auth\/reset-password\/([^"?\s]+)\?callbackURL=([^"\s]+)/.exec(welcome.html);
    if (!link) throw new Error(`no tokenized reset link in: ${welcome.html.slice(0, 400)}`);
    const [, token = '', callback = ''] = link;
    expect(token.length).toBeGreaterThan(16);
    expect(decodeURIComponent(callback)).toContain('/update-password');

    // The token resolves to the AGENT, never to the admin who created the account.
    const [agentRow] = await db.select().from(users).where(eq(users.email, VALID.email));
    const [row] = await db
      .select({ value: verifications.value })
      .from(verifications)
      .where(eq(verifications.identifier, `reset-password:${token}`));
    expect(row?.value).toBe(agentRow?.id);
    expect(row?.value).not.toBe(superId);

    // The tokenless link that caused the bounce cannot come back.
    expect(welcome.html).not.toContain('/reset-password"');
  });

  it('stays ONE email — the token rides the welcome template, code and temp password intact', async () => {
    sendMailMock.mockClear();
    mockSession(superId);
    const res = await create(VALID);
    const body = res.json<{ account: { code: string; temp_password: string } }>();

    const sent = sendMailMock.mock.calls
      .map((call) => call[0] as { to: string; subject: string; html: string })
      .filter((mail) => mail.to === VALID.email);
    expect(sent).toHaveLength(1);
    const welcome = sent[0];
    if (!welcome) throw new Error('no welcome email captured');
    expect(welcome.subject).toContain('Bienvenue');
    expect(welcome.html).toContain(body.account.code);
    expect(welcome.html).toContain(body.account.temp_password);
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

  it('created agent signs in with its SYSTEM-generated password (not any typed value)', async () => {
    mockSession(superId);
    const createRes = await create(VALID);
    expect(createRes.statusCode).toBe(201);
    const tempPassword = createRes.json<{ account: { temp_password: string | null } }>().account
      .temp_password;
    expect(tempPassword).not.toBeNull();
    if (tempPassword === null) throw new Error('expected a generated temp password'); // narrows
    const res = await app.inject({
      method: 'POST',
      url: '/api/signin',
      payload: { email: 'agent1@example.com', password: tempPassword },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ user: { role: string; status: string } }>();
    expect(body.user.role).toBe('screenhost_agent');
    expect(body.user.status).toBe('approved');
  });

  it('agent creation returns + persists a unique code (screenhost_agent → SH)', async () => {
    mockSession(superId);
    const res = await create(VALID); // role screenhost_agent
    expect(res.statusCode).toBe(201);
    const code = res.json<{ account: { code: string | null } }>().account.code;
    expect(code).not.toBeNull();
    // screenhost_agent → 'SH' prefix + 6 digits (8 chars total).
    expect(code).toMatch(/^SH\d{6}$/);
    // persisted in agents, keyed by the new user, matching the returned value
    const [u] = await db.select().from(users).where(eq(users.email, 'agent1@example.com'));
    const [agentRow] = await db
      .select()
      .from(agents)
      .where(eq(agents.userId, u?.id ?? ''));
    expect(agentRow?.code).toBe(code);
  });

  it('screencast_agent creation also issues a code (→ SC)', async () => {
    mockSession(superId);
    const res = await create({ ...VALID, email: 'agent2@example.com', role: 'screencast_agent' });
    expect(res.statusCode).toBe(201);
    // screencast_agent → 'SC' prefix + 6 digits.
    expect(res.json<{ account: { code: string | null } }>().account.code).toMatch(/^SC\d{6}$/);
  });

  it('non-agent (admin) creation issues no code and writes no agents row', async () => {
    mockSession(superId);
    const res = await create({ ...VALID, email: 'admin2@example.com', role: 'admin' });
    expect(res.statusCode).toBe(201);
    expect(res.json<{ account: { code: string | null } }>().account.code).toBeNull();
    const [u] = await db.select().from(users).where(eq(users.email, 'admin2@example.com'));
    const rows = await db
      .select()
      .from(agents)
      .where(eq(agents.userId, u?.id ?? ''));
    expect(rows).toHaveLength(0);
  });

  it('agent creation returns a strong system-generated temp password (≥12) + a code', async () => {
    mockSession(superId);
    const res = await create(VALID); // screenhost_agent
    expect(res.statusCode).toBe(201);
    const { account } = res.json<{
      account: { temp_password: string | null; code: string | null };
    }>();
    expect(account.temp_password).not.toBeNull();
    expect((account.temp_password ?? '').length).toBeGreaterThanOrEqual(12);
    expect(account.code).toMatch(/^SH\d{6}$/);
  });

  it('admin creation returns no generated password (admin-typed)', async () => {
    mockSession(superId);
    const res = await create({ ...VALID, email: 'admin5@example.com', role: 'admin' });
    expect(res.statusCode).toBe(201);
    expect(
      res.json<{ account: { temp_password: string | null } }>().account.temp_password,
    ).toBeNull();
  });

  it('agent creation sends a welcome email; admin creation does not', async () => {
    mockSession(superId);
    const sendSpy = vi.spyOn(emailSender, 'send');
    await create(VALID); // agent → one welcome email
    expect(sendSpy).toHaveBeenCalledTimes(1);
    await create({ ...VALID, email: 'admin6@example.com', role: 'admin' });
    expect(sendSpy).toHaveBeenCalledTimes(1); // admin sends nothing
  });

  it('a welcome-email send failure does NOT block agent creation (non-blocking)', async () => {
    mockSession(superId);
    vi.spyOn(emailSender, 'send').mockResolvedValueOnce({ error: 'smtp down' });
    const res = await create(VALID);
    expect(res.statusCode).toBe(201);
    expect(res.json<{ account: { code: string | null } }>().account.code).toMatch(/^SH\d{6}$/);
    // the account is really persisted despite the email failure
    const [u] = await db.select().from(users).where(eq(users.email, 'agent1@example.com'));
    expect(u?.id).toBeTruthy();
  });

  it('agent creation provisions the agent to the hub with the exact payload', async () => {
    mockSession(superId);
    const res = await create(VALID); // screenhost_agent
    expect(res.statusCode).toBe(201);
    const { account } = res.json<{
      account: { code: string | null; temp_password: string | null };
    }>();
    const [u] = await db.select().from(users).where(eq(users.email, 'agent1@example.com'));
    expect(pushAgentSpy).toHaveBeenCalledTimes(1);
    // code = hub username; the SAME generated password rides the authed channel.
    expect(pushAgentSpy).toHaveBeenCalledWith(
      {
        toodooh_user_id: u?.id,
        code: account.code,
        email: 'agent1@example.com',
        password: account.temp_password,
        role: 'screenhost_agent',
      },
      expect.anything(), // request.log
    );
  });

  it('admin creation does NOT push to the hub (agents only)', async () => {
    mockSession(superId);
    const res = await create({ ...VALID, email: 'admin7@example.com', role: 'admin' });
    expect(res.statusCode).toBe(201);
    expect(pushAgentSpy).not.toHaveBeenCalled();
  });

  it('a hub push failure does NOT block agent creation (non-blocking)', async () => {
    mockSession(superId);
    pushAgentSpy.mockRejectedValueOnce(new Error('hub down'));
    const res = await create(VALID);
    expect(res.statusCode).toBe(201);
    expect(res.json<{ account: { code: string | null } }>().account.code).toMatch(/^SH\d{6}$/);
    const [u] = await db.select().from(users).where(eq(users.email, 'agent1@example.com'));
    expect(u?.id).toBeTruthy();
  });

  // ADM-FIX1 — an ADMIN now passes the route guard (they create agents; see the admin cases
  // below). A NON-STAFF actor still never reaches the handler.
  it('non-staff actor (advertiser) → 403 FORBIDDEN', async () => {
    const advertiserId = await seedUser({ role: 'advertiser', status: 'approved' });
    mockSession(advertiserId, 'advertiser');
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

  it('admin password < 12 → 400', async () => {
    mockSession(superId);
    const res = await create({
      ...VALID,
      email: 'admin3@example.com',
      role: 'admin',
      password: 'shortpwd',
    });
    expect(res.statusCode).toBe(400);
    expect(
      res.json<{ fields: { field: string }[] }>().fields.some((f) => f.field === 'password'),
    ).toBe(true);
  });

  it('admin missing password → 400 (agents are exempt — they generate)', async () => {
    mockSession(superId);
    const noPw = { email: 'admin4@example.com', contact_name: VALID.contact_name, role: 'admin' };
    expect((await create(noPw)).statusCode).toBe(400);
  });

  // GET /api/admin/agents — the FX3 "read returns the status" layer (the agent-listing UI is 2.7).
  it('GET /api/admin/agents returns each agent with its hub export_status (default pending)', async () => {
    mockSession(superId);
    await create(VALID); // screenhost_agent; pushAgentToHub is mocked → export_status stays 'pending'
    const res = await app.inject({ method: 'GET', url: '/api/admin/agents' });
    expect(res.statusCode).toBe(200);
    const { agents: list } = res.json<{
      agents: Array<{
        email: string;
        contact_name: string;
        role: string;
        code: string;
        export_status: string;
      }>;
    }>();
    const row = list.find((a) => a.email === 'agent1@example.com');
    expect(row).toBeDefined();
    expect(row?.code).toMatch(/^SH\d{6}$/);
    expect(row?.role).toBe('screenhost_agent');
    expect(row?.contact_name).toBe('Agent One');
    expect(row?.export_status).toBe('pending'); // default until a real hub push stamps it
  });

  it('GET /api/admin/agents excludes non-agent accounts', async () => {
    mockSession(superId);
    await create({ ...VALID, email: 'admin8@example.com', role: 'admin' }); // admin → no agents row
    const res = await app.inject({ method: 'GET', url: '/api/admin/agents' });
    expect(res.statusCode).toBe(200);
    const { agents: list } = res.json<{ agents: Array<{ email: string }> }>();
    expect(list.some((a) => a.email === 'admin8@example.com')).toBe(false);
  });

  // ADM-FIX1 (operator ruling) — an ADMIN, not only a superadmin, SEES and CREATES the agents.
  // The two escalation paths (creating an `admin`, the staff listing) stay superadmin-only.
  it('GET /api/admin/agents is readable by a plain ADMIN → 200 with the account view', async () => {
    mockSession(superId);
    await create(VALID);
    const adminId = await seedUser({ role: 'admin', status: 'approved' });
    mockSession(adminId, 'admin');
    const res = await app.inject({ method: 'GET', url: '/api/admin/agents' });
    expect(res.statusCode).toBe(200);
    const { agents: list } = res.json<{
      agents: Array<{
        id: string;
        email: string;
        first_name: string;
        last_name: string;
        is_active: boolean;
        created_at: string;
        code: string;
      }>;
    }>();
    const row = list.find((a) => a.email === 'agent1@example.com');
    expect(row).toBeDefined();
    // The widened view /admin-management renders the row from (same shape as GET /admin/admins).
    expect(row?.id).toBeTruthy();
    expect(row?.first_name).toBe('Agent');
    expect(row?.last_name).toBe('One');
    expect(row?.is_active).toBe(true);
    expect(row?.created_at).toBeTruthy();
    expect(row?.code).toMatch(/^SH\d{6}$/);
  });

  it('a plain ADMIN creates an agent → 201', async () => {
    const adminId = await seedUser({ role: 'admin', status: 'approved' });
    mockSession(adminId, 'admin');
    const res = await create({ ...VALID, email: 'agent-by-admin@example.com' });
    expect(res.statusCode).toBe(201);
    expect(res.json<{ account: { role: string } }>().account.role).toBe('screenhost_agent');
  });

  it('a plain ADMIN creating an `admin` → 403 (privilege escalation), in French', async () => {
    const adminId = await seedUser({ role: 'admin', status: 'approved' });
    mockSession(adminId, 'admin');
    const res = await create({
      email: 'admin-by-admin@example.com',
      contact_name: 'Peer Admin',
      role: 'admin',
      password: 'a-strong-pass-12',
    });
    expect(res.statusCode).toBe(403);
    expect(res.json<{ message: string }>().message).toBe(
      'Seul le Super Administrateur peut créer un compte administrateur.',
    );
    // The escalation never reached the DB.
    const [row] = await db
      .select()
      .from(users)
      .where(eq(users.email, 'admin-by-admin@example.com'));
    expect(row).toBeUndefined();
  });

  it('a superadmin still creates an `admin` → 201', async () => {
    mockSession(superId);
    const res = await create({
      email: 'admin-by-super@example.com',
      contact_name: 'Staff Admin',
      role: 'admin',
      password: 'a-strong-pass-12',
    });
    expect(res.statusCode).toBe(201);
    expect(res.json<{ account: { role: string } }>().account.role).toBe('admin');
  });
});
