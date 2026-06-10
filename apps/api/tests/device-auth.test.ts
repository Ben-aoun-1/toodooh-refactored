import { eq } from 'drizzle-orm';
import Fastify, { type FastifyRequest } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import { deviceSessions, users } from '../src/db/schema.js';
import { requireDeviceAuth } from '../src/middleware/require-device-auth.js';
import { deviceAuthRoutes } from '../src/routes/device-auth.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// Integration suite — real Postgres. Users are created through better-auth's signUpEmail so the
// credential accounts row carries a REAL scrypt hash (the exact thing verifyPassword checks);
// nodemailer is mocked so the verification email "sends" without SMTP.
const { sendMailMock } = vi.hoisted(() => ({
  sendMailMock: vi.fn().mockResolvedValue({ messageId: 'test-msg-id' }),
}));
vi.mock('nodemailer', () => ({
  default: { createTransport: vi.fn(() => ({ sendMail: sendMailMock })) },
}));

const PASSWORD = 'a-strong-passw0rd';

const createUser = async (
  email: string,
  opts: { role?: string; status?: string; verified?: boolean } = {},
): Promise<string> => {
  const res = await auth.api.signUpEmail({
    body: {
      email,
      password: PASSWORD,
      name: 'TV Owner',
      businessName: 'TV Biz',
      contactPhone: '+21612345678',
      taxNumber: `TX${Date.now() % 100000000}`,
    },
  });
  await db
    .update(users)
    .set({
      emailVerified: opts.verified ?? true,
      role: (opts.role ?? 'individual_owner') as 'individual_owner',
      status: (opts.status ?? 'approved') as 'approved',
    })
    .where(eq(users.id, res.user.id));
  return res.user.id;
};

interface LoginBody {
  access_token: string;
  refresh_token: string;
  user: { id: string; email: string; role: string };
}

const buildApp = () => Fastify({ logger: false });

describe('device token auth /api/device/auth/* (real Postgres)', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    await resetAuthTables();
    app = buildApp();
    await app.register(deviceAuthRoutes);
    // Probe route: exercises requireDeviceAuth exactly as commit 2's /api/screens/* will.
    app.get('/probe', { preHandler: requireDeviceAuth }, async (request: FastifyRequest) => ({
      userId: request.user?.id,
      role: request.user?.role,
    }));
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await sql.end();
  });

  const login = (email: string, password = PASSWORD, deviceType = 'android-tv') =>
    app.inject({
      method: 'POST',
      url: '/api/device/auth/login',
      payload: { email, password, device_type: deviceType },
    });
  const refresh = (refreshToken: string) =>
    app.inject({
      method: 'POST',
      url: '/api/device/auth/refresh',
      payload: { refresh_token: refreshToken },
    });
  const probe = (accessToken?: string) =>
    app.inject({
      method: 'GET',
      url: '/probe',
      headers: accessToken ? { authorization: `Bearer ${accessToken}` } : {},
    });

  it('login happy → the ApiAuth.kt contract shape, hashed-at-rest session row', async () => {
    const userId = await createUser('tv-owner@example.com');
    const res = await login('tv-owner@example.com');
    expect(res.statusCode).toBe(200);
    const body = res.json<LoginBody>();
    expect(body.user).toEqual({
      id: userId,
      email: 'tv-owner@example.com',
      role: 'individual_owner',
    });
    expect(body.access_token).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(body.refresh_token).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(body.access_token).not.toBe(body.refresh_token);

    const [row] = await db.select().from(deviceSessions).where(eq(deviceSessions.userId, userId));
    expect(row).toBeDefined();
    expect(row?.deviceType).toBe('android-tv');
    // Stored HASHED — the raw token never lands in the DB.
    expect(row?.accessTokenHash).not.toBe(body.access_token);
    expect(row?.refreshTokenHash).not.toBe(body.refresh_token);
    expect(row?.accessTokenHash).toMatch(/^[a-f0-9]{64}$/);
    // TTLs: access ~12h, refresh ~90d.
    const accessMs = (row?.accessExpiresAt.getTime() ?? 0) - Date.now();
    const refreshMs = (row?.refreshExpiresAt.getTime() ?? 0) - Date.now();
    expect(accessMs).toBeGreaterThan(11 * 3600 * 1000);
    expect(accessMs).toBeLessThan(13 * 3600 * 1000);
    expect(refreshMs).toBeGreaterThan(89 * 24 * 3600 * 1000);
  });

  it('fleet_owner can also log in', async () => {
    await createUser('fleet@example.com', { role: 'fleet_owner' });
    const res = await login('fleet@example.com');
    expect(res.statusCode).toBe(200);
    expect(res.json<LoginBody>().user.role).toBe('fleet_owner');
  });

  it('wrong password and unknown email → identical 401 (no enumeration)', async () => {
    await createUser('tv-owner@example.com');
    const wrongPw = await login('tv-owner@example.com', 'not-the-password');
    const noUser = await login('ghost@example.com');
    expect(wrongPw.statusCode).toBe(401);
    expect(noUser.statusCode).toBe(401);
    expect(wrongPw.json<{ error: string }>().error).toBe('INVALID_CREDENTIALS');
    expect(noUser.json<{ error: string }>().error).toBe('INVALID_CREDENTIALS');
  });

  it('disallowed role (advertiser) → 403 FORBIDDEN, no session row', async () => {
    const userId = await createUser('adv@example.com', { role: 'advertiser' });
    const res = await login('adv@example.com');
    expect(res.statusCode).toBe(403);
    expect(res.json<{ error: string }>().error).toBe('FORBIDDEN');
    expect(
      await db.select().from(deviceSessions).where(eq(deviceSessions.userId, userId)),
    ).toHaveLength(0);
  });

  it('unapproved owner → 403 ACCOUNT_NOT_APPROVED', async () => {
    await createUser('pending@example.com', { status: 'pending' });
    const res = await login('pending@example.com');
    expect(res.statusCode).toBe(403);
    expect(res.json<{ error: string }>().error).toBe('ACCOUNT_NOT_APPROVED');
  });

  it('unverified email → 403 EMAIL_NOT_VERIFIED (the web-signin gate, not bypassed)', async () => {
    const userId = await createUser('unverified@example.com', { verified: false });
    const res = await login('unverified@example.com');
    expect(res.statusCode).toBe(403);
    expect(res.json<{ error: string }>().error).toBe('EMAIL_NOT_VERIFIED');
    expect(
      await db.select().from(deviceSessions).where(eq(deviceSessions.userId, userId)),
    ).toHaveLength(0);
  });

  it('verified + approved owner is accepted (the gate composes, not blocks)', async () => {
    await createUser('verified-ok@example.com', { verified: true, status: 'approved' });
    expect((await login('verified-ok@example.com')).statusCode).toBe(200);
  });

  it('missing device_type → 400', async () => {
    await createUser('tv-owner@example.com');
    const res = await app.inject({
      method: 'POST',
      url: '/api/device/auth/login',
      payload: { email: 'tv-owner@example.com', password: PASSWORD },
    });
    expect(res.statusCode).toBe(400);
  });

  it('refresh ROTATES both tokens — the old pair is dead, the new pair works', async () => {
    await createUser('tv-owner@example.com');
    const first = (await login('tv-owner@example.com')).json<LoginBody>();

    const rotated = await refresh(first.refresh_token);
    expect(rotated.statusCode).toBe(200);
    const next = rotated.json<{ access_token: string; refresh_token: string }>();
    expect(next.access_token).not.toBe(first.access_token);
    expect(next.refresh_token).not.toBe(first.refresh_token);

    // New access authenticates; the old one is dead.
    expect((await probe(next.access_token)).statusCode).toBe(200);
    expect((await probe(first.access_token)).statusCode).toBe(401);
    // Old refresh replay → 401 (rotation killed it); the new one still rotates.
    expect((await refresh(first.refresh_token)).statusCode).toBe(401);
    expect((await refresh(next.refresh_token)).statusCode).toBe(200);
  });

  it('revoked session → guard AND refresh both 401', async () => {
    const userId = await createUser('tv-owner@example.com');
    const body = (await login('tv-owner@example.com')).json<LoginBody>();
    await db
      .update(deviceSessions)
      .set({ revokedAt: new Date() })
      .where(eq(deviceSessions.userId, userId));
    expect((await probe(body.access_token)).statusCode).toBe(401);
    expect((await refresh(body.refresh_token)).statusCode).toBe(401);
  });

  it('expired access → guard 401, but the refresh path still rotates', async () => {
    const userId = await createUser('tv-owner@example.com');
    const body = (await login('tv-owner@example.com')).json<LoginBody>();
    await db
      .update(deviceSessions)
      .set({ accessExpiresAt: new Date(Date.now() - 1000) })
      .where(eq(deviceSessions.userId, userId));
    expect((await probe(body.access_token)).statusCode).toBe(401);
    expect((await refresh(body.refresh_token)).statusCode).toBe(200);
  });

  it('expired refresh → 401 on refresh', async () => {
    const userId = await createUser('tv-owner@example.com');
    const body = (await login('tv-owner@example.com')).json<LoginBody>();
    await db
      .update(deviceSessions)
      .set({ refreshExpiresAt: new Date(Date.now() - 1000) })
      .where(eq(deviceSessions.userId, userId));
    expect((await refresh(body.refresh_token)).statusCode).toBe(401);
  });

  it('bearer guard: happy path attaches request.user; missing/garbage tokens → 401', async () => {
    const userId = await createUser('tv-owner@example.com');
    const body = (await login('tv-owner@example.com')).json<LoginBody>();
    const ok = await probe(body.access_token);
    expect(ok.statusCode).toBe(200);
    expect(ok.json<{ userId: string; role: string }>()).toEqual({
      userId,
      role: 'individual_owner',
    });
    expect((await probe()).statusCode).toBe(401);
    expect((await probe('not-a-real-token')).statusCode).toBe(401);
    const noBearer = await app.inject({
      method: 'GET',
      url: '/probe',
      headers: { authorization: body.access_token },
    });
    expect(noBearer.statusCode).toBe(401);
  });
});
