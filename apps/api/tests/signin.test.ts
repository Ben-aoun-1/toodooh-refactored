import { eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import { users } from '../src/db/schema.js';
import { apiRoutes } from '../src/routes/index.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// nodemailer mocked → createVerifiedUser's signUpEmail (and the unverified-sign-in re-send) "send"
// without a real SMTP connection. Integration suite — real Postgres (DATABASE_URL). No getSession
// mock: sign-in mints a REAL cookie + session row, and the round-trip validates it through the real
// require-auth guard (the boundary Commit 3 could only test with a mock).
const { sendMailMock } = vi.hoisted(() => ({
  sendMailMock: vi.fn().mockResolvedValue({ messageId: 'test-msg-id' }),
}));
vi.mock('nodemailer', () => ({
  default: { createTransport: vi.fn(() => ({ sendMail: sendMailMock })) },
}));

const buildApp = () => Fastify({ logger: false });

const PASSWORD = 'a-strong-passw0rd';

// Create a sign-in-able user: signUpEmail hashes the password into an `accounts` row; the UPDATE
// flips email_verified (sign-in is blocked while unverified) and sets the role/business_type the
// profile_type reconstruction is tested against.
const createVerifiedUser = async (
  email: string,
  opts: { role?: string; businessType?: string | null; verified?: boolean } = {},
): Promise<string> => {
  const res = await auth.api.signUpEmail({
    body: {
      email,
      password: PASSWORD,
      name: 'Sign In User',
      businessName: 'SignIn Biz',
      contactPhone: '+21612345678',
      taxNumber: `TX${Date.now() % 100000000}`,
    },
  });
  await db
    .update(users)
    .set({
      emailVerified: opts.verified ?? true,
      ...(opts.role ? { role: opts.role as 'advertiser' } : {}),
      ...(opts.businessType !== undefined ? { businessType: opts.businessType } : {}),
    })
    .where(eq(users.id, res.user.id));
  return res.user.id;
};

// Set-Cookie → a Cookie request header: each cookie's name=value head (before the first ';'),
// joined. (The Cookie header carries no attributes.)
const cookieHeader = (setCookie: string | string[] | undefined): string => {
  const arr = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  return arr.map((c) => c.split(';')[0]).join('; ');
};

describe('POST /api/signin + /api/signout (real Postgres)', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    await resetAuthTables();
    app = buildApp();
    await app.register(apiRoutes);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await sql.end();
  });

  const signin = (email: string, password: string) =>
    app.inject({ method: 'POST', url: '/api/signin', payload: { email, password } });

  it('valid credentials → 200, routing shape, session cookie set', async () => {
    await createVerifiedUser('valid@example.com');
    const res = await signin('valid@example.com', PASSWORD);
    expect(res.statusCode).toBe(200);
    const body = res.json<{
      user: {
        id: string;
        email: string;
        role: string;
        status: string;
        onboarding_completed: boolean;
        business_type: string | null;
        profile_type: string | null;
        contact_name: string | null;
      };
    }>();
    expect(body.user.email).toBe('valid@example.com');
    expect(body.user.role).toBe('advertiser');
    expect(body.user.status).toBe('pending');
    expect(body.user.onboarding_completed).toBe(false);
    expect(body.user.profile_type).toBe('advertiser');
    expect(body.user.contact_name).toBe('Sign In User');
    expect(res.headers['set-cookie']).toBeDefined();
  });

  it('rejected account: signin still SUCCEEDS and returns status + rejection reason', async () => {
    // N3: rejection gates the APP, not authentication. The rejected user must be able to sign in so
    // they can later fix + resubmit (C3). signin therefore returns 200 with status + validation_notes.
    const userId = await createVerifiedUser('rejected@example.com');
    await db
      .update(users)
      .set({ status: 'rejected', validationNotes: 'Documents illisibles, merci de renvoyer.' })
      .where(eq(users.id, userId));
    const res = await signin('rejected@example.com', PASSWORD);
    expect(res.statusCode).toBe(200);
    const { user } = res.json<{ user: { status: string; validation_notes: string | null } }>();
    expect(user.status).toBe('rejected');
    expect(user.validation_notes).toBe('Documents illisibles, merci de renvoyer.');
    expect(res.headers['set-cookie']).toBeDefined();
  });

  it('non-rejected account: validation_notes is null', async () => {
    await createVerifiedUser('clean@example.com');
    const res = await signin('clean@example.com', PASSWORD);
    expect(res.json<{ user: { validation_notes: string | null } }>().user.validation_notes).toBe(
      null,
    );
  });

  it('wrong password → generic 401', async () => {
    await createVerifiedUser('pw@example.com');
    const res = await signin('pw@example.com', 'wrong-passw0rd!!');
    expect(res.statusCode).toBe(401);
    expect(res.json<{ error: string }>().error).toBe('INVALID_CREDENTIALS');
  });

  it('unknown email → identical generic 401 (no enumeration)', async () => {
    const res = await signin('nobody@example.com', PASSWORD);
    expect(res.statusCode).toBe(401);
    expect(res.json<{ error: string }>().error).toBe('INVALID_CREDENTIALS');
  });

  it('unverified user → 403 EMAIL_NOT_VERIFIED', async () => {
    await createVerifiedUser('unverified@example.com', { verified: false });
    const res = await signin('unverified@example.com', PASSWORD);
    expect(res.statusCode).toBe(403);
    expect(res.json<{ error: string }>().error).toBe('EMAIL_NOT_VERIFIED');
  });

  it('empty body → 400', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/signin', payload: {} });
    expect(res.statusCode).toBe(400);
  });

  it('profile_type: agency (advertiser + business_type=agency)', async () => {
    await createVerifiedUser('agency@example.com', { businessType: 'agency' });
    const res = await signin('agency@example.com', PASSWORD);
    expect(res.json<{ user: { profile_type: string } }>().user.profile_type).toBe('agency');
  });

  it('profile_type: individual_owner', async () => {
    await createVerifiedUser('indiv@example.com', { role: 'individual_owner' });
    const res = await signin('indiv@example.com', PASSWORD);
    expect(res.json<{ user: { profile_type: string } }>().user.profile_type).toBe(
      'individual_owner',
    );
  });

  it('profile_type: fleet_owner', async () => {
    await createVerifiedUser('fleet@example.com', { role: 'fleet_owner' });
    const res = await signin('fleet@example.com', PASSWORD);
    expect(res.json<{ user: { profile_type: string } }>().user.profile_type).toBe('fleet_owner');
  });

  it('THE round-trip: real cookie → PATCH /api/profile/business → 200, request.user populated', async () => {
    const userId = await createVerifiedUser('roundtrip@example.com');
    const signInRes = await signin('roundtrip@example.com', PASSWORD);
    const cookie = cookieHeader(signInRes.headers['set-cookie']);
    expect(cookie).toContain('session');

    const patch = await app.inject({
      method: 'PATCH',
      url: '/api/profile/business',
      headers: { cookie },
      payload: { business_name: 'RoundTrip Co' },
    });
    expect(patch.statusCode).toBe(200);
    const [row] = await db.select().from(users).where(eq(users.id, userId));
    expect(row?.businessName).toBe('RoundTrip Co'); // the guard resolved the cookie → this user
  });

  it('sign-out: clears the cookie; the cleared cookie no longer authenticates', async () => {
    await createVerifiedUser('signout@example.com');
    const signInRes = await signin('signout@example.com', PASSWORD);
    const cookie = cookieHeader(signInRes.headers['set-cookie']);

    const out = await app.inject({ method: 'POST', url: '/api/signout', headers: { cookie } });
    expect(out.statusCode).toBe(200);

    // The session row is gone → the original cookie no longer authenticates.
    const after = await app.inject({
      method: 'PATCH',
      url: '/api/profile/business',
      headers: { cookie },
      payload: { business_name: 'Nope' },
    });
    expect(after.statusCode).toBe(401);
  });

  it('unauthenticated sign-out → 401', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/signout' });
    expect(res.statusCode).toBe(401);
  });
});
