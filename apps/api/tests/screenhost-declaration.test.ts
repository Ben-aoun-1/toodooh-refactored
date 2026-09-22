import { asc, eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import {
  campaigns,
  creatives,
  deviceSessions,
  type NewUser,
  proofOfPlay,
  screenhosts,
  screens,
  users,
} from '../src/db/schema.js';
import { hashDeviceToken, newTokenPair } from '../src/lib/device-tokens.js';
import { screenhostDeclarationRoutes } from '../src/routes/screenhost-declaration.js';
import { screenhostsRoutes } from '../src/routes/screenhosts.js';
import { screensRoutes } from '../src/routes/screens.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// SCR-DECL1 — the per-venue declared screens / rooms edit (real Postgres). Owner route + admin
// twin share ONE reconciliation (lib/screens.ts): before approval only the columns move; after
// approval the screens rows follow the count, never below the installed ones. The APK's
// GET /api/screens/mine must list exactly the rows after every change. Q7: no hub re-push — the
// wedooh push is spied on to prove it is never called.
const pushSpy = vi.hoisted(() =>
  vi.fn<(ownerId: string, logger: unknown) => Promise<void>>(() => Promise.resolve()),
);
vi.mock('../src/lib/wedooh-sync.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/wedooh-sync.js')>();
  return { ...actual, pushApprovedOwnerLocations: pushSpy };
});

type GetSessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;

const buildApp = () => Fastify({ logger: false });

const mockSession = (userId: string, role = 'individual_owner', status = 'approved'): void => {
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
      email: `decl${seq}@example.com`,
      contactName: `User ${seq}`,
      role: 'individual_owner',
      status: 'approved',
      ...values,
    })
    .returning();
  return u?.id ?? '';
};

const seedVenue = async (ownerId: string, screenCount = 0): Promise<string> => {
  const [sh] = await db
    .insert(screenhosts)
    .values({ name: 'Café Déclaré', city: 'Tunis', ownerId, screenCount })
    .returning();
  return sh?.id ?? '';
};

const T0 = new Date('2026-09-01T08:00:00Z');

/** Rows « Écran 1..n »; `installed` numbers get a paired_at (odd) or a last_seen_at (even). */
const seedRows = async (
  screenhostId: string,
  n: number,
  installed: number[] = [],
): Promise<Record<string, string>> => {
  const ids: Record<string, string> = {};
  for (let i = 1; i <= n; i += 1) {
    const stamp = installed.includes(i)
      ? i % 2 === 1
        ? { pairedAt: T0 }
        : { lastSeenAt: T0 }
      : {};
    const [row] = await db
      .insert(screens)
      .values({ screenhostId, name: `Écran ${i}`, createdAt: new Date(T0.getTime() + i), ...stamp })
      .returning({ id: screens.id });
    ids[`Écran ${i}`] = row?.id ?? '';
  }
  return ids;
};

const rowNames = async (screenhostId: string): Promise<string[]> =>
  (
    await db
      .select({ name: screens.name })
      .from(screens)
      .where(eq(screens.screenhostId, screenhostId))
      .orderBy(asc(screens.name))
  ).map((r) => r.name);

const declaredOf = async (id: string) => {
  const [row] = await db
    .select({ screenCount: screenhosts.screenCount, roomCount: screenhosts.roomCount })
    .from(screenhosts)
    .where(eq(screenhosts.id, id));
  return row;
};

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

describe('the declared screens / rooms edit (SCR-DECL1, real Postgres)', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    await resetAuthTables();
    pushSpy.mockClear();
    app = buildApp();
    await app.register(screenhostDeclarationRoutes);
    await app.register(screenhostsRoutes);
    await app.register(screensRoutes);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await sql.end();
  });

  const patchOwner = (id: string, payload: unknown) =>
    app.inject({
      method: 'PATCH',
      url: `/api/screenhosts/${id}/declaration`,
      payload: payload as never,
    });
  const patchAdmin = (id: string, payload: unknown) =>
    app.inject({
      method: 'PATCH',
      url: `/api/admin/screenhosts/${id}/declaration`,
      payload: payload as never,
    });
  /** What the TV app lists — the rows it can pair against. */
  const apkNames = async (token: string): Promise<string[]> => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/screens/mine',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    return res.json<{ name: string }[]>().map((s) => s.name);
  };

  // ── before approval: the columns only (D2) ────────────────────────────────────
  it('before approval an edit only changes the columns — approval will materialise the rows', async () => {
    const owner = await seedUser({ status: 'pending' });
    const venue = await seedVenue(owner, 0);
    mockSession(owner, 'individual_owner', 'pending');
    const res = await patchOwner(venue, { screen_count: 3, room_count: 2 });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      id: venue,
      name: 'Café Déclaré',
      screen_count: 3,
      room_count: 2,
      screens_count: 0,
    });
    expect(await declaredOf(venue)).toEqual({ screenCount: 3, roomCount: 2 });
    expect(await rowNames(venue)).toEqual([]);
  });

  // ── after approval: the rows follow the count (Q2, D3) ────────────────────────
  it('raising the count adds « Écran N » rows, and the APK lists exactly them', async () => {
    const owner = await seedUser();
    const venue = await seedVenue(owner, 2);
    await seedRows(venue, 2);
    const token = await seedDeviceToken(owner);
    mockSession(owner);
    const res = await patchOwner(venue, { screen_count: 4 });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ screen_count: 4, screens_count: 4 });
    expect(await rowNames(venue)).toEqual(['Écran 1', 'Écran 2', 'Écran 3', 'Écran 4']);
    expect(await apkNames(token)).toEqual(['Écran 1', 'Écran 2', 'Écran 3', 'Écran 4']);
  });

  it('lowering deletes never-installed rows only, highest numbers first — the APK follows', async () => {
    const owner = await seedUser();
    const venue = await seedVenue(owner, 5);
    // Écran 2 has reported (last_seen_at), Écran 5 was paired (paired_at): both INSTALLED, both stay.
    await seedRows(venue, 5, [2, 5]);
    const token = await seedDeviceToken(owner);
    mockSession(owner);
    const res = await patchOwner(venue, { screen_count: 3 });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ screen_count: 3, screens_count: 3 });
    expect(await rowNames(venue)).toEqual(['Écran 1', 'Écran 2', 'Écran 5']);
    expect(await apkNames(token)).toEqual(['Écran 1', 'Écran 2', 'Écran 5']);

    // Raising again takes the lowest FREE numbers (3, then 4), never a duplicate.
    const again = await patchOwner(venue, { screen_count: 5 });
    expect(again.statusCode).toBe(200);
    expect(await apkNames(token)).toEqual(['Écran 1', 'Écran 2', 'Écran 3', 'Écran 4', 'Écran 5']);
  });

  it('lowering below the installed count is refused (409, French) and changes nothing', async () => {
    const owner = await seedUser();
    const venue = await seedVenue(owner, 3);
    await seedRows(venue, 3, [1, 2]);
    const token = await seedDeviceToken(owner);
    mockSession(owner);
    const res = await patchOwner(venue, { screen_count: 1, room_count: 4 });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({
      error: 'BELOW_INSTALLED_SCREENS',
      message:
        "Ce lieu compte 2 écrans déjà installés : le nombre d'écrans ne peut pas descendre en dessous de 2.",
      installed_screens_count: 2,
    });
    // The whole edit is refused — rooms included.
    expect(await declaredOf(venue)).toEqual({ screenCount: 3, roomCount: null });
    expect(await apkNames(token)).toEqual(['Écran 1', 'Écran 2', 'Écran 3']);

    // Down to exactly the installed count is fine: only the never-installed Écran 3 goes.
    const ok = await patchOwner(venue, { screen_count: 2 });
    expect(ok.statusCode).toBe(200);
    expect(await apkNames(token)).toEqual(['Écran 1', 'Écran 2']);
  });

  it('a row carrying proof of play is kept even without a pairing stamp (the FK is RESTRICT)', async () => {
    const owner = await seedUser();
    const venue = await seedVenue(owner, 2);
    const rows = await seedRows(venue, 2);
    const advertiser = await seedUser({ role: 'advertiser' });
    const [campaign] = await db
      .insert(campaigns)
      .values({ advertiserId: advertiser, name: 'Preuve', campaignType: 'standard' })
      .returning();
    const [creative] = await db
      .insert(creatives)
      .values({
        advertiserId: advertiser,
        creativeType: 'video',
        storageKey: 'creatives/scr-decl1/proof',
        durationSeconds: 10,
        validationStatus: 'approved',
      })
      .returning();
    await db.insert(proofOfPlay).values({
      screenId: rows['Écran 2'] ?? '',
      screenhostId: venue,
      campaignId: campaign?.id ?? '',
      creativeId: creative?.id ?? '',
      videoIdAsSent: campaign?.id ?? '',
      eventType: 'VIDEO_ENDED',
      playedDurationMs: 10_000,
    });
    mockSession(owner);
    const res = await patchOwner(venue, { screen_count: 1 });
    expect(res.statusCode, res.body).toBe(200); // Écran 1 goes, Écran 2 (proof) stays
    expect(await rowNames(venue)).toEqual(['Écran 2']);
  });

  it('a room-only edit never touches the rows', async () => {
    const owner = await seedUser();
    const venue = await seedVenue(owner, 3);
    await seedRows(venue, 1); // a legacy venue whose rows disagree with its count
    mockSession(owner);
    const res = await patchOwner(venue, { room_count: 2 });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ screen_count: 3, room_count: 2, screens_count: 1 });
    expect(await rowNames(venue)).toEqual(['Écran 1']);
  });

  // ── scoping, guards, validation ───────────────────────────────────────────────
  it('the owner route is owner-scoped: a foreign venue is a 404, untouched', async () => {
    const owner = await seedUser();
    const other = await seedUser();
    const foreign = await seedVenue(other, 2);
    mockSession(owner);
    const res = await patchOwner(foreign, { screen_count: 5 });
    expect(res.statusCode).toBe(404);
    expect(await declaredOf(foreign)).toEqual({ screenCount: 2, roomCount: null });
  });

  it('a rejected owner is refused by the status gate (403)', async () => {
    const owner = await seedUser({ status: 'rejected' });
    const venue = await seedVenue(owner, 2);
    mockSession(owner, 'individual_owner', 'rejected');
    expect((await patchOwner(venue, { screen_count: 3 })).statusCode).toBe(403);
  });

  it('the admin twin edits any venue through the same reconciliation', async () => {
    const owner = await seedUser({ role: 'fleet_owner' });
    const venue = await seedVenue(owner, 1);
    await seedRows(venue, 1, [1]);
    const admin = await seedUser({ role: 'admin' });
    mockSession(admin, 'admin');
    const res = await patchAdmin(venue, { screen_count: 3, room_count: 1 });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ screen_count: 3, room_count: 1, screens_count: 3 });
    expect(await rowNames(venue)).toEqual(['Écran 1', 'Écran 2', 'Écran 3']);
    const refused = await patchAdmin(venue, { screen_count: 0 });
    expect(refused.statusCode).toBe(400); // D1: 1 minimum, before any row logic
  });

  it('a venue that already has rows follows the count whatever the owner status (re-approval skips it)', async () => {
    // Approved once (rows exist), rejected since: a re-approval would skip this venue, so the edit
    // must move the rows itself or they would disagree with the count forever.
    const owner = await seedUser({ status: 'rejected' });
    const venue = await seedVenue(owner, 2);
    await seedRows(venue, 2);
    const admin = await seedUser({ role: 'admin' });
    mockSession(admin, 'admin');
    expect((await patchAdmin(venue, { screen_count: 3 })).statusCode).toBe(200);
    expect(await rowNames(venue)).toEqual(['Écran 1', 'Écran 2', 'Écran 3']);
    expect((await patchAdmin(venue, { screen_count: 1 })).statusCode).toBe(200);
    expect(await rowNames(venue)).toEqual(['Écran 1']);
  });

  it('the admin twin is admin-only (403 for an owner, 401 without a session)', async () => {
    const owner = await seedUser();
    const venue = await seedVenue(owner, 1);
    mockSession(owner);
    expect((await patchAdmin(venue, { screen_count: 2 })).statusCode).toBe(403);
    vi.restoreAllMocks();
    vi.spyOn(auth.api, 'getSession').mockResolvedValue(null as unknown as GetSessionResult);
    expect((await patchAdmin(venue, { screen_count: 2 })).statusCode).toBe(401);
    expect((await patchOwner(venue, { screen_count: 2 })).statusCode).toBe(401);
  });

  it('validates the body: whole numbers 1–99 (D1), at least one field, a uuid id', async () => {
    const owner = await seedUser();
    const venue = await seedVenue(owner, 2);
    mockSession(owner);
    for (const body of [
      {},
      { screen_count: 0 },
      { screen_count: 100 },
      { screen_count: 2.5 },
      { screen_count: '3' },
      { room_count: 0 },
      { room_count: null },
    ]) {
      expect((await patchOwner(venue, body)).statusCode).toBe(400);
    }
    expect((await patchOwner('not-a-uuid', { screen_count: 2 })).statusCode).toBe(400);
    expect(await declaredOf(venue)).toEqual({ screenCount: 2, roomCount: null });
  });

  // ── the reads ─────────────────────────────────────────────────────────────────
  it('GET /api/screenhosts/mine carries each venue’s screen_count and room_count', async () => {
    const owner = await seedUser({ role: 'fleet_owner' });
    await seedVenue(owner, 3);
    const second = await seedVenue(owner, 0);
    await db.update(screenhosts).set({ roomCount: 2 }).where(eq(screenhosts.id, second));
    mockSession(owner, 'fleet_owner');
    const res = await app.inject({ method: 'GET', url: '/api/screenhosts/mine' });
    expect(res.statusCode).toBe(200);
    const rows = res.json<{ screen_count: number; room_count: number | null }[]>();
    expect(rows.map((r) => [r.screen_count, r.room_count])).toEqual(
      expect.arrayContaining([
        [3, null],
        [0, 2],
      ]),
    );
  });

  it('never re-pushes to the hub (Q7)', async () => {
    const owner = await seedUser();
    const venue = await seedVenue(owner, 1);
    await seedRows(venue, 1);
    mockSession(owner);
    expect((await patchOwner(venue, { screen_count: 2, room_count: 1 })).statusCode).toBe(200);
    expect(pushSpy).not.toHaveBeenCalled();
  });
});
