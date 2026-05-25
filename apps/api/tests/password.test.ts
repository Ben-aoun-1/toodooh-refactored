import { eq, like } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth, emailSender } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import { users, verifications } from '../src/db/schema.js';
import { apiRoutes } from '../src/routes/index.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// nodemailer mocked → the real SMTP transport never connects; signUpEmail's verification email and
// the reset email both "send" through it. Anti-enum / SMTP-fail assertions spy emailSender.send
// directly (the seam the never-throw reset hook calls). Integration suite — real Postgres.
const { sendMailMock } = vi.hoisted(() => ({
  sendMailMock: vi.fn().mockResolvedValue({ messageId: 'test-msg-id' }),
}));
vi.mock('nodemailer', () => ({
  default: { createTransport: vi.fn(() => ({ sendMail: sendMailMock })) },
}));

const buildApp = () => Fastify({ logger: false });

const PASSWORD = 'a-strong-passw0rd';
const NEW_PASSWORD = 'a-new-passw0rd-xyz';

// Create a sign-in-able user: signUpEmail hashes the password into an `accounts` row; the UPDATE
// flips email_verified (sign-in is blocked while unverified).
const createVerifiedUser = async (email: string): Promise<string> => {
  const res = await auth.api.signUpEmail({
    body: {
      email,
      password: PASSWORD,
      name: 'Password User',
      businessName: 'Pwd Biz',
      contactPhone: '+21612345678',
      taxNumber: `TX${Date.now() % 100000000}`,
    },
  });
  await db.update(users).set({ emailVerified: true }).where(eq(users.id, res.user.id));
  return res.user.id;
};

// The reset token is a verifications-table ROW (identifier 'reset-password:<token>'), NOT a JWT
// (better-auth password.mjs). resetPassword reconstructs the identifier from the submitted token,
// so the submittable token is the suffix after the prefix.
const RESET_PREFIX = 'reset-password:';
const resetTokenFor = async (): Promise<string> => {
  const [row] = await db
    .select()
    .from(verifications)
    .where(like(verifications.identifier, `${RESET_PREFIX}%`));
  if (!row) throw new Error('reset token row not found');
  return row.identifier.slice(RESET_PREFIX.length);
};

// Set-Cookie → a Cookie request header: each cookie's name=value head (before the first ';'), joined.
const cookieHeader = (setCookie: string | string[] | undefined): string => {
  const arr = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  return arr.map((c) => c.split(';')[0]).join('; ');
};

describe('password management: reset-request + reset + change (real Postgres)', () => {
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

  const resetRequest = (email: string) =>
    app.inject({ method: 'POST', url: '/api/password/reset-request', payload: { email } });

  // --- reset-request (anti-enumeration) ---

  it('reset-request existing email → 200, reset email sent', async () => {
    await createVerifiedUser('exists@example.com');
    const sendSpy = vi.spyOn(emailSender, 'send'); // after signup → starts at zero
    const res = await resetRequest('exists@example.com');
    expect(res.statusCode).toBe(200);
    expect(res.json<{ success: boolean }>().success).toBe(true);
    expect(sendSpy).toHaveBeenCalledTimes(1);
  });

  it('reset-request unknown email → identical 200, no email sent (no enumeration)', async () => {
    const sendSpy = vi.spyOn(emailSender, 'send');
    const res = await resetRequest('nobody@example.com');
    expect(res.statusCode).toBe(200);
    expect(res.json<{ success: boolean }>().success).toBe(true);
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('reset-request SMTP failure → still generic 200 (hook never throws)', async () => {
    await createVerifiedUser('smtpfail@example.com');
    const sendSpy = vi.spyOn(emailSender, 'send');
    sendSpy.mockResolvedValueOnce({ error: 'smtp down' });
    const res = await resetRequest('smtpfail@example.com');
    expect(res.statusCode).toBe(200);
    expect(res.json<{ success: boolean }>().success).toBe(true);
    expect(sendSpy).toHaveBeenCalledTimes(1);
  });

  it('reset-request invalid email → 400', async () => {
    const res = await resetRequest('not-an-email');
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toBe('INVALID_INPUT');
  });

  // --- reset (complete) ---

  it('reset valid token → 200; new password works, old password rejected', async () => {
    await createVerifiedUser('resetme@example.com');
    expect((await resetRequest('resetme@example.com')).statusCode).toBe(200);
    const token = await resetTokenFor();

    const res = await app.inject({
      method: 'POST',
      url: '/api/password/reset',
      payload: { token, new_password: NEW_PASSWORD },
    });
    expect(res.statusCode).toBe(200);

    expect((await signin('resetme@example.com', NEW_PASSWORD)).statusCode).toBe(200);
    expect((await signin('resetme@example.com', PASSWORD)).statusCode).toBe(401);
  });

  it('reset invalid token → 400 INVALID_TOKEN', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/password/reset',
      payload: { token: 'bogus-token-value', new_password: NEW_PASSWORD },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toBe('INVALID_TOKEN');
  });

  it('reset new password < 12 chars → 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/password/reset',
      payload: { token: 'whatever', new_password: 'short' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toBe('INVALID_INPUT');
  });

  // --- change (authenticated) ---

  const change = (cookie: string, current: string, next: string) =>
    app.inject({
      method: 'POST',
      url: '/api/password/change',
      headers: { cookie },
      payload: { current_password: current, new_password: next },
    });

  it('change correct current → 200; new password works, old rejected', async () => {
    await createVerifiedUser('changeme@example.com');
    const cookie = cookieHeader(
      (await signin('changeme@example.com', PASSWORD)).headers['set-cookie'],
    );

    const res = await change(cookie, PASSWORD, NEW_PASSWORD);
    expect(res.statusCode).toBe(200);

    expect((await signin('changeme@example.com', NEW_PASSWORD)).statusCode).toBe(200);
    expect((await signin('changeme@example.com', PASSWORD)).statusCode).toBe(401);
  });

  it('change wrong current → 400 INVALID_CREDENTIALS', async () => {
    await createVerifiedUser('wrongcur@example.com');
    const cookie = cookieHeader(
      (await signin('wrongcur@example.com', PASSWORD)).headers['set-cookie'],
    );

    const res = await change(cookie, 'wrong-passw0rd!!', NEW_PASSWORD);
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toBe('INVALID_CREDENTIALS');
  });

  it('change unauthenticated → 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/password/change',
      payload: { current_password: PASSWORD, new_password: NEW_PASSWORD },
    });
    expect(res.statusCode).toBe(401);
  });

  it('change new password < 12 chars → 400', async () => {
    await createVerifiedUser('shortpw@example.com');
    const cookie = cookieHeader(
      (await signin('shortpw@example.com', PASSWORD)).headers['set-cookie'],
    );

    const res = await change(cookie, PASSWORD, 'short');
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toBe('INVALID_INPUT');
  });

  it('change revokes other sessions; the current device survives via the refreshed cookie', async () => {
    await createVerifiedUser('multi@example.com');
    // Two independent sessions: A = the device that changes the password, B = another device.
    const cookieA = cookieHeader(
      (await signin('multi@example.com', PASSWORD)).headers['set-cookie'],
    );
    const cookieB = cookieHeader(
      (await signin('multi@example.com', PASSWORD)).headers['set-cookie'],
    );

    const res = await change(cookieA, PASSWORD, NEW_PASSWORD);
    expect(res.statusCode).toBe(200);
    const refreshed = cookieHeader(res.headers['set-cookie']);
    expect(refreshed).toContain('session');

    const patch = (cookie: string) =>
      app.inject({
        method: 'PATCH',
        url: '/api/profile/business',
        headers: { cookie },
        payload: { business_name: 'After Change' },
      });

    // The other device (B) and the now-stale original cookie (A) both die (delete-all);
    // only the refreshed cookie from the change response authenticates (D4).
    expect((await patch(cookieB)).statusCode).toBe(401);
    expect((await patch(cookieA)).statusCode).toBe(401);
    expect((await patch(refreshed)).statusCode).toBe(200);
  });
});
