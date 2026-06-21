import { eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import { type NewUser, deviceSessions, screenhosts, screens, users } from '../src/db/schema.js';
import { hashDeviceToken, newTokenPair } from '../src/lib/device-tokens.js';
import { createMissingScreensForOwner } from '../src/lib/screens.js';
import { adminRoutes } from '../src/routes/admin.js';
import { screensRoutes } from '../src/routes/screens.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// Integration suite — real Postgres. Device sessions are seeded directly (login mechanics
// live in device-auth.test.ts); the admin approve→generation path runs the REAL admin route
// with a mocked admin session, mirroring admin.test.ts.
type GetSessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;

const buildApp = () => Fastify({ logger: false });

const mockAdminSession = (userId: string): void => {
  vi.spyOn(auth.api, 'getSession').mockResolvedValue({
    session: {},
    user: { id: userId, role: 'superadmin', status: 'approved' },
  } as unknown as GetSessionResult);
};

let seq = 0;
const seedUser = async (values: Partial<NewUser> = {}): Promise<string> => {
  seq += 1;
  const [u] = await db
    .insert(users)
    .values({ email: `scr${seq}@example.com`, contactName: `User ${seq}`, ...values })
    .returning();
  return u?.id ?? '';
};

const seedScreenhost = async (
  ownerId: string,
  opts: { name?: string; city?: string; screenCount?: number; lat?: string; lng?: string } = {},
): Promise<string> => {
  const [s] = await db
    .insert(screenhosts)
    .values({
      name: opts.name ?? 'Café Test',
      city: opts.city ?? 'Tunis',
      screenCount: opts.screenCount ?? 1,
      ownerId,
      ...(opts.lat !== undefined ? { latitude: opts.lat } : {}),
      ...(opts.lng !== undefined ? { longitude: opts.lng } : {}),
    })
    .returning();
  return s?.id ?? '';
};

// A real device_sessions row → a usable bearer token, without the login round-trip.
const seedDeviceToken = async (userId: string): Promise<string> => {
  const pair = newTokenPair(new Date());
  await db.insert(deviceSessions).values({
    userId,
    accessTokenHash: hashDeviceToken(pair.accessToken),
    refreshTokenHash: hashDeviceToken(pair.refreshToken),
    accessExpiresAt: pair.accessExpiresAt,
    refreshExpiresAt: pair.refreshExpiresAt,
    deviceType: 'android-tv',
  });
  return pair.accessToken;
};

interface ScreenView {
  id: string;
  name: string;
  location: string;
  status: string;
  is_online: boolean;
}

describe('screens + pair/GPS-link (real Postgres)', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    await resetAuthTables();
    app = buildApp();
    await app.register(screensRoutes);
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

  const mine = (token: string) =>
    app.inject({
      method: 'GET',
      url: '/api/screens/mine',
      headers: { authorization: `Bearer ${token}` },
    });
  const pair = (token: string, screenId: string, body: Record<string, unknown> = {}) =>
    app.inject({
      method: 'POST',
      url: `/api/screens/${screenId}/pair`,
      headers: { authorization: `Bearer ${token}` },
      payload: body,
    });

  describe('generation', () => {
    it('approving an owner materializes "Écran 1..N" per screenhost', async () => {
      const adminId = await seedUser({ role: 'superadmin', status: 'approved' });
      const owner = await seedUser({ role: 'fleet_owner', status: 'pending' });
      const hostA = await seedScreenhost(owner, { name: 'Hôtel A', screenCount: 3 });
      const hostB = await seedScreenhost(owner, { name: 'Resto B', screenCount: 2 });

      mockAdminSession(adminId);
      const res = await app.inject({
        method: 'POST',
        url: `/api/admin/users/${owner}/approve`,
        payload: {},
      });
      expect(res.statusCode).toBe(200);

      const rowsA = await db.select().from(screens).where(eq(screens.screenhostId, hostA));
      const rowsB = await db.select().from(screens).where(eq(screens.screenhostId, hostB));
      expect(rowsA.map((r) => r.name).sort()).toEqual(['Écran 1', 'Écran 2', 'Écran 3']);
      expect(rowsB.map((r) => r.name).sort()).toEqual(['Écran 1', 'Écran 2']);
      expect(rowsA.every((r) => r.isActive && r.pairedAt === null)).toBe(true);
    });

    it('reject → re-approve never duplicates; zero screen_count generates nothing', async () => {
      const adminId = await seedUser({ role: 'superadmin', status: 'approved' });
      const owner = await seedUser({ role: 'individual_owner', status: 'pending' });
      const host = await seedScreenhost(owner, { screenCount: 2 });
      const emptyHost = await seedScreenhost(owner, { name: 'Vide', screenCount: 0 });

      mockAdminSession(adminId);
      const approve = () =>
        app.inject({ method: 'POST', url: `/api/admin/users/${owner}/approve`, payload: {} });
      const reject = () =>
        app.inject({
          method: 'POST',
          url: `/api/admin/users/${owner}/reject`,
          payload: { notes: 'redo', topics: ['legal'] },
        });

      expect((await approve()).statusCode).toBe(200);
      expect((await reject()).statusCode).toBe(200);
      expect((await approve()).statusCode).toBe(200);

      expect(await db.select().from(screens).where(eq(screens.screenhostId, host))).toHaveLength(2);
      expect(
        await db.select().from(screens).where(eq(screens.screenhostId, emptyHost)),
      ).toHaveLength(0);
    });

    it('approving a non-owner (advertiser) creates no screens', async () => {
      const adminId = await seedUser({ role: 'superadmin', status: 'approved' });
      const adv = await seedUser({ role: 'advertiser', status: 'pending' });
      mockAdminSession(adminId);
      await app.inject({ method: 'POST', url: `/api/admin/users/${adv}/approve`, payload: {} });
      expect(await db.select().from(screens)).toHaveLength(0);
    });
  });

  describe('GET /api/screens/mine', () => {
    it('lists every screen across the caller’s screenhosts in the app shape; never another owner’s', async () => {
      const owner = await seedUser({ role: 'fleet_owner', status: 'approved' });
      const other = await seedUser({ role: 'individual_owner', status: 'approved' });
      await seedScreenhost(owner, { name: 'Hôtel A', city: 'Tunis', screenCount: 2 });
      await seedScreenhost(owner, { name: 'Resto B', city: 'Sousse', screenCount: 1 });
      await seedScreenhost(other, { name: 'Chez Autre', screenCount: 4 });
      await createMissingScreensForOwner(owner);
      await createMissingScreensForOwner(other);

      const token = await seedDeviceToken(owner);
      const res = await mine(token);
      expect(res.statusCode).toBe(200);
      const body = res.json<ScreenView[]>();
      expect(body).toHaveLength(3);
      expect(body.map((s) => s.location)).toEqual([
        'Hôtel A — Tunis',
        'Hôtel A — Tunis',
        'Resto B — Sousse',
      ]);
      expect(body.every((s) => s.status === 'active' && s.is_online === false)).toBe(true);
      expect(body.every((s) => typeof s.id === 'string' && s.name.startsWith('Écran'))).toBe(true);
    });

    it('no bearer → 401', async () => {
      expect((await app.inject({ method: 'GET', url: '/api/screens/mine' })).statusCode).toBe(401);
    });
  });

  describe('POST /api/screens/:id/pair — GPS-link rule', () => {
    const setup = async (opts: { lat?: string; lng?: string; screenCount?: number } = {}) => {
      const owner = await seedUser({ role: 'individual_owner', status: 'approved' });
      const host = await seedScreenhost(owner, { screenCount: opts.screenCount ?? 2, ...opts });
      await createMissingScreensForOwner(owner);
      const rows = await db.select().from(screens).where(eq(screens.screenhostId, host));
      const token = await seedDeviceToken(owner);
      return { owner, host, screenIds: rows.map((r) => r.id), token };
    };

    it('first TV wins: coords land on the NULL-island parent; pair stamps paired_at/last_seen_at', async () => {
      const { host, screenIds, token } = await setup();
      const res = await pair(token, screenIds[0] ?? '', { latitude: 36.8065, longitude: 10.1815 });
      expect(res.statusCode).toBe(200);
      expect(res.json<{ paired: boolean; location_linked: boolean }>()).toEqual({
        paired: true,
        location_linked: true,
      });
      const [sh] = await db.select().from(screenhosts).where(eq(screenhosts.id, host));
      expect(Number(sh?.latitude)).toBeCloseTo(36.8065);
      expect(Number(sh?.longitude)).toBeCloseTo(10.1815);
      const [scr] = await db
        .select()
        .from(screens)
        .where(eq(screens.id, screenIds[0] ?? ''));
      expect(scr?.pairedAt).not.toBeNull();
      expect(scr?.lastSeenAt).not.toBeNull();
    });

    it('later pairs NEVER overwrite — second TV’s coords are dropped, response says so', async () => {
      const { host, screenIds, token } = await setup();
      await pair(token, screenIds[0] ?? '', { latitude: 36.8065, longitude: 10.1815 });
      const second = await pair(token, screenIds[1] ?? '', { latitude: 35.0, longitude: 9.0 });
      expect(second.json<{ location_linked: boolean }>().location_linked).toBe(false);
      const [sh] = await db.select().from(screenhosts).where(eq(screenhosts.id, host));
      expect(Number(sh?.latitude)).toBeCloseTo(36.8065);
      expect(Number(sh?.longitude)).toBeCloseTo(10.1815);
    });

    it('a screenhost that ALREADY has coordinates is never overwritten (pre-existing geo)', async () => {
      const { host, screenIds, token } = await setup({ lat: '36.00000000', lng: '10.00000000' });
      const res = await pair(token, screenIds[0] ?? '', { latitude: 35.5, longitude: 9.5 });
      expect(res.json<{ location_linked: boolean }>().location_linked).toBe(false);
      const [sh] = await db.select().from(screenhosts).where(eq(screenhosts.id, host));
      expect(Number(sh?.latitude)).toBeCloseTo(36.0);
    });

    it('fleet case: coords land on the PICKED screen’s parent screenhost only', async () => {
      const owner = await seedUser({ role: 'fleet_owner', status: 'approved' });
      const hostA = await seedScreenhost(owner, { name: 'A', screenCount: 1 });
      const hostB = await seedScreenhost(owner, { name: 'B', screenCount: 1 });
      await createMissingScreensForOwner(owner);
      const [screenB] = await db.select().from(screens).where(eq(screens.screenhostId, hostB));
      const token = await seedDeviceToken(owner);

      const res = await pair(token, screenB?.id ?? '', { latitude: 35.8256, longitude: 10.6369 });
      expect(res.json<{ location_linked: boolean }>().location_linked).toBe(true);
      const [a] = await db.select().from(screenhosts).where(eq(screenhosts.id, hostA));
      const [b] = await db.select().from(screenhosts).where(eq(screenhosts.id, hostB));
      expect(a?.latitude).toBeNull();
      expect(Number(b?.latitude)).toBeCloseTo(35.8256);
    });

    it('pair without coords links nothing but still pairs; re-pair is idempotent', async () => {
      const { host, screenIds, token } = await setup();
      const res = await pair(token, screenIds[0] ?? '');
      expect(res.json<{ paired: boolean; location_linked: boolean }>()).toEqual({
        paired: true,
        location_linked: false,
      });
      const [sh] = await db.select().from(screenhosts).where(eq(screenhosts.id, host));
      expect(sh?.latitude).toBeNull();
      // Re-pair: still 200, still no coords, no duplicate rows.
      expect((await pair(token, screenIds[0] ?? '')).statusCode).toBe(200);
      expect(await db.select().from(screens).where(eq(screens.screenhostId, host))).toHaveLength(2);
    });

    it('cross-owner pairing → 404 (indistinguishable from missing)', async () => {
      const { screenIds } = await setup();
      const stranger = await seedUser({ role: 'individual_owner', status: 'approved' });
      const strangerToken = await seedDeviceToken(stranger);
      const res = await pair(strangerToken, screenIds[0] ?? '', {
        latitude: 36.8,
        longitude: 10.18,
      });
      expect(res.statusCode).toBe(404);
    });

    it('out-of-range coordinates → 400', async () => {
      const { screenIds, token } = await setup();
      expect(
        (await pair(token, screenIds[0] ?? '', { latitude: 91, longitude: 10 })).statusCode,
      ).toBe(400);
    });
  });
});
