import { eq } from 'drizzle-orm';
import Fastify, { type FastifyRequest } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import { deviceSessions, notifications, users } from '../src/db/schema.js';
import { authenticateScreenWs } from '../src/lib/playout/ws-auth.js';
import {
  buildMessages,
  EXPO_PUSH_URL,
  PUSH_OUTBOX_WINDOW_MS,
  runPushOutboxTick,
} from '../src/lib/push/push-outbox.js';
import { requireAuth } from '../src/middleware/require-auth.js';
import { requireDeviceAuth } from '../src/middleware/require-device-auth.js';
import { deviceAuthRoutes } from '../src/routes/device-auth.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// MOBILE-1 — the screenhost phone app (toodooh-mobile): its device sessions ('mobile') reach the
// owner surface (requireAuth) by bearer token; TV sessions never do, and a phone never acts as a TV.
const { sendMailMock } = vi.hoisted(() => ({
  sendMailMock: vi.fn().mockResolvedValue({ messageId: 'test-msg-id' }),
}));
vi.mock('nodemailer', () => ({
  default: { createTransport: vi.fn(() => ({ sendMail: sendMailMock })) },
}));

const PASSWORD = 'a-strong-passw0rd';
const PHONE_TOKEN = 'ExponentPushToken[phone-A]';

const createOwner = async (email: string): Promise<string> => {
  const res = await auth.api.signUpEmail({
    body: {
      email,
      password: PASSWORD,
      name: 'Phone Owner',
      businessName: 'Phone Biz',
      contactPhone: '+21612345678',
      taxNumber: `TX${Date.now() % 100000000}`,
    },
  });
  await db
    .update(users)
    .set({ emailVerified: true, role: 'individual_owner', status: 'approved' })
    .where(eq(users.id, res.user.id));
  return res.user.id;
};

const buildApp = () => Fastify({ logger: false });

const log = { warn: vi.fn() } as unknown as Parameters<typeof runPushOutboxTick>[0];

describe('MOBILE-1 — phone sessions on the owner surface (real Postgres)', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    await resetAuthTables();
    app = buildApp();
    await app.register(deviceAuthRoutes);
    app.get('/owner-probe', { preHandler: requireAuth }, async (request: FastifyRequest) => ({
      userId: request.user?.id,
    }));
    app.get('/tv-probe', { preHandler: requireDeviceAuth }, async (request: FastifyRequest) => ({
      userId: request.user?.id,
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

  const login = async (email: string, deviceType: string): Promise<string> => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/device/auth/login',
      payload: { email, password: PASSWORD, device_type: deviceType },
    });
    expect(res.statusCode).toBe(200);
    return (res.json() as { access_token: string }).access_token;
  };
  const get = (url: string, token?: string) =>
    app.inject({
      method: 'GET',
      url,
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
  const post = (url: string, token: string, payload?: object) =>
    app.inject({
      method: 'POST',
      url,
      headers: { authorization: `Bearer ${token}` },
      ...(payload ? { payload } : {}),
    });

  it('a phone token passes requireAuth as its owner; a TV token and a garbage token do not', async () => {
    const userId = await createOwner('phone@example.com');
    const phone = await login('phone@example.com', 'mobile');
    const tv = await login('phone@example.com', 'android_streamer');

    const ok = await get('/owner-probe', phone);
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ userId });
    expect((await get('/owner-probe', tv)).statusCode).toBe(401);
    expect((await get('/owner-probe', 'garbage')).statusCode).toBe(401);
    // No header at all → the cookie path, which has no session here.
    expect((await get('/owner-probe')).statusCode).toBe(401);
  });

  it('a phone token never acts as a TV (HTTP guard and screen socket)', async () => {
    await createOwner('phone@example.com');
    const phone = await login('phone@example.com', 'mobile');
    const tv = await login('phone@example.com', 'android_streamer');
    expect((await get('/tv-probe', phone)).statusCode).toBe(401);
    expect((await get('/tv-probe', tv)).statusCode).toBe(200);

    const ws = await authenticateScreenWs(phone, '00000000-0000-4000-8000-000000000000');
    expect(ws).toMatchObject({ ok: false, reason: 'invalid or expired token' });
  });

  it('logout revokes the phone session and drops its push token', async () => {
    const userId = await createOwner('phone@example.com');
    const phone = await login('phone@example.com', 'mobile');
    expect(
      (await post('/api/device/push-token', phone, { expo_push_token: PHONE_TOKEN })).statusCode,
    ).toBe(204);

    expect((await post('/api/device/auth/logout', phone)).statusCode).toBe(204);
    const [row] = await db.select().from(deviceSessions).where(eq(deviceSessions.userId, userId));
    expect(row?.revokedAt).not.toBeNull();
    expect(row?.pushToken).toBeNull();
    expect((await get('/owner-probe', phone)).statusCode).toBe(401);
  });

  it('a TV token cannot log a phone out or register a push token', async () => {
    await createOwner('phone@example.com');
    const tv = await login('phone@example.com', 'android_streamer');
    expect((await post('/api/device/auth/logout', tv)).statusCode).toBe(401);
    expect(
      (await post('/api/device/push-token', tv, { expo_push_token: PHONE_TOKEN })).statusCode,
    ).toBe(401);
  });

  it('push token: validated, null deregisters, and a token moves to the newest session', async () => {
    const a = await createOwner('a@example.com');
    const b = await createOwner('b@example.com');
    const phoneA = await login('a@example.com', 'mobile');
    const phoneB = await login('b@example.com', 'mobile');

    expect(
      (await post('/api/device/push-token', phoneA, { expo_push_token: 'not-a-token' })).statusCode,
    ).toBe(400);
    await post('/api/device/push-token', phoneA, { expo_push_token: PHONE_TOKEN });
    // The same phone now signs in to account B: A must stop receiving on it.
    await post('/api/device/push-token', phoneB, { expo_push_token: PHONE_TOKEN });
    const tokenOf = async (userId: string) =>
      (await db.select().from(deviceSessions).where(eq(deviceSessions.userId, userId)))[0]
        ?.pushToken;
    expect(await tokenOf(a)).toBeNull();
    expect(await tokenOf(b)).toBe(PHONE_TOKEN);

    expect(
      (await post('/api/device/push-token', phoneB, { expo_push_token: null })).statusCode,
    ).toBe(204);
    expect(await tokenOf(b)).toBeNull();
  });

  it('the outbox pushes a fresh notification once, to the owner phone only, and drops dead tokens', async () => {
    const owner = await createOwner('phone@example.com');
    const other = await createOwner('other@example.com');
    const phone = await login('phone@example.com', 'mobile');
    await post('/api/device/push-token', phone, { expo_push_token: PHONE_TOKEN });
    await db.insert(notifications).values([
      { userId: owner, type: 'dispatch_pending_acceptance', title: 'Nouvelle demande', body: 'b' },
      { userId: other, type: 'monthly_report_ready', title: 'Rapport', body: 'b' },
    ]);

    const sent: unknown[] = [];
    const fetchMock = vi.fn((url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe(EXPO_PUSH_URL);
      sent.push(...(JSON.parse(String(init?.body)) as unknown[]));
      return Promise.resolve(
        new Response(
          JSON.stringify({
            data: [{ status: 'error', details: { error: 'DeviceNotRegistered' } }],
          }),
          { status: 200 },
        ),
      );
    });

    const first = await runPushOutboxTick(log, new Date(), fetchMock as typeof fetch);
    expect(first).toEqual({ claimed: 2, sent: 1 });
    expect(sent).toEqual([
      expect.objectContaining({
        to: PHONE_TOKEN,
        title: 'Nouvelle demande',
        channelId: 'allocations',
        data: expect.objectContaining({ type: 'dispatch_pending_acceptance' }),
      }),
    ]);
    // Expo said the device is gone → the token is dropped.
    const [row] = await db.select().from(deviceSessions).where(eq(deviceSessions.userId, owner));
    expect(row?.pushToken).toBeNull();
    // Claimed once: a second tick sends nothing.
    expect(await runPushOutboxTick(log, new Date(), fetchMock as typeof fetch)).toEqual({
      claimed: 0,
      sent: 0,
    });
  });

  it('the phone changes its password: other phones signed out, the TV and this phone kept', async () => {
    const userId = await createOwner('phone@example.com');
    const phone = await login('phone@example.com', 'mobile');
    const otherPhone = await login('phone@example.com', 'mobile');
    const tv = await login('phone@example.com', 'android_streamer');
    const NEW = 'An0ther-strong-pass';

    const res = await post('/api/device/password/change', phone, {
      current_password: PASSWORD,
      new_password: NEW,
    });
    expect(res.statusCode).toBe(204);

    expect((await get('/owner-probe', phone)).statusCode).toBe(200);
    expect((await get('/owner-probe', otherPhone)).statusCode).toBe(401);
    expect((await get('/tv-probe', tv)).statusCode).toBe(200);
    // The old password no longer signs in; the new one does (same hash the web signin checks).
    const old = await app.inject({
      method: 'POST',
      url: '/api/device/auth/login',
      payload: { email: 'phone@example.com', password: PASSWORD, device_type: 'mobile' },
    });
    expect(old.statusCode).toBe(401);
    const fresh = await app.inject({
      method: 'POST',
      url: '/api/device/auth/login',
      payload: { email: 'phone@example.com', password: NEW, device_type: 'mobile' },
    });
    expect(fresh.statusCode).toBe(200);
    expect(
      (await db.select().from(deviceSessions).where(eq(deviceSessions.userId, userId))).length,
    ).toBe(4);
  });

  it('password change: wrong current → 400 INVALID_CREDENTIALS, short new → 400, TV token → 401', async () => {
    await createOwner('phone@example.com');
    const phone = await login('phone@example.com', 'mobile');
    const tv = await login('phone@example.com', 'android_streamer');

    const wrong = await post('/api/device/password/change', phone, {
      current_password: 'not-my-password',
      new_password: 'An0ther-strong-pass',
    });
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json()).toMatchObject({ error: 'INVALID_CREDENTIALS' });

    const short = await post('/api/device/password/change', phone, {
      current_password: PASSWORD,
      new_password: 'Sh0rt',
    });
    expect(short.statusCode).toBe(400);
    expect(short.json()).toMatchObject({ error: 'INVALID_INPUT' });

    const fromTv = await post('/api/device/password/change', tv, {
      current_password: PASSWORD,
      new_password: 'An0ther-strong-pass',
    });
    expect(fromTv.statusCode).toBe(401);
  });

  it('buildMessages never sends a row older than the outbox window', () => {
    const now = new Date('2026-10-10T12:00:00Z');
    const row = (ageMs: number) => ({
      id: 'n1',
      user_id: 'u1',
      type: 't',
      title: 'x',
      body: 'y',
      campaign_id: null,
      created_at: new Date(now.getTime() - ageMs),
    });
    const tokens = new Map([['u1', [PHONE_TOKEN]]]);
    expect(buildMessages([row(PUSH_OUTBOX_WINDOW_MS)], tokens, now)).toHaveLength(1);
    expect(buildMessages([row(PUSH_OUTBOX_WINDOW_MS + 1)], tokens, now)).toHaveLength(0);
  });
});
