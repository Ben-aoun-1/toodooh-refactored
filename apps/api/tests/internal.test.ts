import { eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { db, sql } from '../src/db/client.js';
import {
  agents,
  businessSectors,
  governorates,
  screenhostAffluence,
  screenhostAffluenceHourly,
  screenhostMonthlyStats,
  screenhosts,
  screens,
  users,
} from '../src/db/schema.js';
import { encryptWifiPassword } from '../src/lib/wifi-crypto.js';
import { internalRoutes } from '../src/routes/internal.js';

import { resetAuthTables, bothHalves } from './helpers/db-test-setup.js';

// Integration suite — real Postgres (DATABASE_URL). The /api/internal/* surface is service-
// authenticated (Bearer WEDOOH_SYNC_KEY); the plugin takes the key as an option so the test never
// depends on the eagerly-parsed env singleton. resetAuthTables TRUNCATE ... CASCADE from users
// clears screenhosts/screens/agents/screenhost_affluence (all FK-reachable). sql is shared, so it
// is closed ONCE at the file level — never per-describe.

const SYNC_KEY = 'test-sync-key-0123456789';
const auth = (key = SYNC_KEY) => ({ authorization: `Bearer ${key}` });

const buildApp = (opts: { syncKey?: string } = { syncKey: SYNC_KEY }) => {
  const app = Fastify({ logger: false });
  app.register(internalRoutes, opts);
  return app;
};

afterAll(async () => {
  await sql.end();
});

describe('/api/internal/* — service-key guard', () => {
  let app: ReturnType<typeof buildApp> | undefined;
  beforeEach(async () => {
    await resetAuthTables();
  });
  afterEach(async () => {
    if (app) await app.close();
    app = undefined;
  });

  it('503 SYNC_DISABLED when the key is not configured', async () => {
    app = buildApp({}); // no syncKey, env unset in test
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/api/internal/locations?email=a@b.c' });
    expect(res.statusCode).toBe(503);
    expect(res.json<{ error: string }>().error).toBe('SYNC_DISABLED');
  });

  it('401 on a missing / wrong Bearer key', async () => {
    app = buildApp();
    await app.ready();
    const missing = await app.inject({ method: 'GET', url: '/api/internal/locations?email=a@b.c' });
    expect(missing.statusCode).toBe(401);
    const wrong = await app.inject({
      method: 'GET',
      url: '/api/internal/locations?email=a@b.c',
      headers: auth('not-the-key-xxxxxxxx'),
    });
    expect(wrong.statusCode).toBe(401);
  });
});

describe('B1: GET /api/internal/locations', () => {
  let app: ReturnType<typeof buildApp> | undefined;
  beforeEach(async () => {
    await resetAuthTables();
    app = buildApp();
    await app.ready();
  });
  afterEach(async () => {
    if (app) await app.close();
    app = undefined;
  });

  it('404 USER_NOT_FOUND for an unknown email', async () => {
    const res = await app!.inject({
      method: 'GET',
      url: '/api/internal/locations?email=nobody@example.com',
      headers: auth(),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json<{ error: string }>().error).toBe('USER_NOT_FOUND');
  });

  it('returns the owner + locations with decrypted WiFi, governorate name, and screens', async () => {
    // Use a SEEDED governorate (migration 0003) — never mutate the shared reference seed (deleting
    // it would break the governorate-count tests in db.test.ts / reference.test.ts).
    const [gov] = await db
      .select({ id: governorates.id, name: governorates.name })
      .from(governorates)
      .limit(1);
    const [owner] = await db
      .insert(users)
      .values({ email: 'owner@example.com', contactName: 'Owner One', role: 'individual_owner' })
      .returning({ id: users.id });
    const [host] = await db
      .insert(screenhosts)
      .values({
        name: 'Café Central',
        ownerId: owner!.id,
        governorateId: gov!.id,
        latitude: '36.80650000',
        longitude: '10.18150000',
        screenCount: 2,
        wifiSsid: 'CafeNet',
        wifiPasswordEncrypted: encryptWifiPassword('s3cret-pw'),
      })
      .returning({ id: screenhosts.id });
    await db.insert(screens).values({ screenhostId: host!.id, name: 'Écran 1' });

    const res = await app!.inject({
      method: 'GET',
      url: '/api/internal/locations?email=OWNER@example.com', // case-insensitive
      headers: auth(),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{
      owner: { email: string };
      locations: Array<{
        name: string;
        latitude: number | null;
        governorate: string | null;
        wifi_ssid: string | null;
        wifi_password: string | null;
        screen_count: number;
        screens: unknown[];
      }>;
    }>();
    expect(body.owner.email).toBe('owner@example.com');
    expect(body.locations).toHaveLength(1);
    const loc = body.locations[0]!;
    expect(loc.name).toBe('Café Central');
    expect(loc.latitude).toBe(36.8065);
    expect(loc.governorate).toBe(gov!.name);
    expect(loc.wifi_ssid).toBe('CafeNet');
    expect(loc.wifi_password).toBe('s3cret-pw'); // decrypted
    expect(loc.screen_count).toBe(2);
    expect(loc.screens).toHaveLength(1);
  });
});

describe('C1: POST /api/internal/affluence', () => {
  let app: ReturnType<typeof buildApp> | undefined;
  beforeEach(async () => {
    await resetAuthTables();
    app = buildApp();
    await app.ready();
  });
  afterEach(async () => {
    if (app) await app.close();
    app = undefined;
  });

  it('upserts known slots and reports unknown location_ids (never fails the batch)', async () => {
    const [host] = await db
      .insert(screenhosts)
      .values({ name: 'Place A' })
      .returning({ id: screenhosts.id });
    const unknownId = '11111111-1111-4111-8111-111111111111';

    const first = await app!.inject({
      method: 'POST',
      url: '/api/internal/affluence',
      headers: auth(),
      payload: {
        slots: [
          { location_id: host!.id, day_of_week: 1, hour: 9, estimated_impressions: 100 },
          { location_id: unknownId, day_of_week: 2, hour: 10, estimated_impressions: 50 },
        ],
      },
    });
    expect(first.statusCode).toBe(200);
    expect(
      first.json<{ upserted: number; slot_rows: number; unknown_locations: string[] }>(),
    ).toEqual({
      upserted: 1,
      slot_rows: 2, // MEJ-13-B — an hour-shaped cell writes BOTH halves
      unknown_locations: [unknownId],
    });

    // Same slot again → latest-value-wins upsert (no duplicate row).
    const second = await app!.inject({
      method: 'POST',
      url: '/api/internal/affluence',
      headers: auth(),
      payload: {
        slots: [{ location_id: host!.id, day_of_week: 1, hour: 9, estimated_impressions: 250 }],
      },
    });
    expect(second.statusCode).toBe(200);
    const rows = await db.select().from(screenhostAffluence);
    // MEJ-13-B — an hour-shaped cell is TWO rows now (both halves, same value: a cell is a level,
    // so half an hour of it is not half the people). Still one cell, still latest-value-wins.
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.estimatedImpressions)).toEqual([250, 250]);
    expect(rows.map((r) => r.slot).sort((a, b) => a - b)).toEqual([18, 19]);
  });

  // MEJ-5 — the ingest stores the hub's (day_of_week, hour) bucket VERBATIM. The contract is
  // Africa/Tunis (the venue's own clock — L-disp compares `hour` against opening/closing_hour),
  // and the hub currently violates it by bucketing in UTC. That is fixed UPSTREAM: a shift added
  // here would double-correct the day the producer is fixed, and would put toodooh's grid an hour
  // away from the hub's own venue page. This pin is the guard against exactly that well-meaning
  // patch landing in toodooh.
  it('MEJ-5: stores the weekday/hour bucket VERBATIM — no timezone shifting api-side', async () => {
    const [host] = await db
      .insert(screenhosts)
      .values({ name: 'Place TZ' })
      .returning({ id: screenhosts.id });

    // 13h Monday in, 13h Monday out — including the wrap-prone edges (00h and 23h).
    const res = await app!.inject({
      method: 'POST',
      url: '/api/internal/affluence',
      headers: auth(),
      payload: {
        slots: [
          { location_id: host!.id, day_of_week: 1, hour: 13, estimated_impressions: 1396 },
          { location_id: host!.id, day_of_week: 1, hour: 0, estimated_impressions: 7 },
          { location_id: host!.id, day_of_week: 7, hour: 23, estimated_impressions: 9 },
        ],
      },
    });
    expect(res.statusCode).toBe(200);

    const rows = await db.select().from(screenhostAffluence);
    // MEJ-13-B — each hour-shaped cell is stored as both of its halves, so assert the DISTINCT
    // (weekday, hour, value) triples: the verbatim contract is about the bucket, not the row count.
    expect(
      [
        ...new Map(
          rows.map((r) => [
            `${r.dayOfWeek}|${r.hour}`,
            [r.dayOfWeek, r.hour, r.estimatedImpressions],
          ]),
        ).values(),
      ].sort((a, b) => a[0]! - b[0]! || a[1]! - b[1]!),
    ).toEqual([
      [1, 0, 7],
      [1, 13, 1396],
      [7, 23, 9],
    ]);
  });

  // AFF1 — provenance. The hub sends source: 'measured' | 'backup' on every slot (HUB-AFF1); it is
  // stored beside the value and overwritten latest-wins like the value itself. Display-only: no
  // pricing path reads it (grep-proof in the lane notes).
  const pushOne = (locationId: string, slot: { estimated_impressions: number; source?: string }) =>
    app!.inject({
      method: 'POST',
      url: '/api/internal/affluence',
      headers: auth(),
      payload: { slots: [{ location_id: locationId, day_of_week: 2, hour: 10, ...slot }] },
    });

  it('AFF1: stores the slot provenance and overwrites it latest-wins on re-push', async () => {
    const [host] = await db
      .insert(screenhosts)
      .values({ name: 'Place A' })
      .returning({ id: screenhosts.id });

    expect(
      (await pushOne(host!.id, { estimated_impressions: 0, source: 'measured' })).statusCode,
    ).toBe(200);
    let rows = await db.select().from(screenhostAffluence);
    // MEJ-13-B — an hour-shaped cell is TWO rows (both halves, same value); provenance rides
    // on both, so asserting the first row still asserts the cell.
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.source === 'measured')).toBe(true);

    // The hub's merge flipped this slot to the manual backup → the stored provenance follows.
    expect(
      (await pushOne(host!.id, { estimated_impressions: 40, source: 'backup' })).statusCode,
    ).toBe(200);
    rows = await db.select().from(screenhostAffluence);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.source === 'backup')).toBe(true);
    expect(rows.every((r) => r.estimatedImpressions === 40)).toBe(true);
  });

  it('AFF1: an absent source stores NULL (older hub stays compatible) — on first push and on re-push', async () => {
    const [host] = await db
      .insert(screenhosts)
      .values({ name: 'Place A' })
      .returning({ id: screenhosts.id });

    expect((await pushOne(host!.id, { estimated_impressions: 12 })).statusCode).toBe(200);
    let rows = await db.select().from(screenhostAffluence);
    expect(rows[0]!.source).toBeNull();

    // A provenance-less re-push clears a previously known provenance: NULL = unknown, never stale.
    expect(
      (await pushOne(host!.id, { estimated_impressions: 12, source: 'measured' })).statusCode,
    ).toBe(200);
    expect((await pushOne(host!.id, { estimated_impressions: 12 })).statusCode).toBe(200);
    rows = await db.select().from(screenhostAffluence);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.source === null)).toBe(true);
  });

  it('AFF1: 400 on an invalid source (like any other field)', async () => {
    const [host] = await db
      .insert(screenhosts)
      .values({ name: 'Place A' })
      .returning({ id: screenhosts.id });
    const res = await pushOne(host!.id, { estimated_impressions: 5, source: 'sensor' });
    expect(res.statusCode).toBe(400);
    expect(
      res.json<{ fields: { field: string }[] }>().fields.some((f) => f.field === 'slots.0.source'),
    ).toBe(true);
    expect(await db.select().from(screenhostAffluence)).toHaveLength(0);
  });

  it('400 on a bad slot (hour out of range)', async () => {
    const res = await app!.inject({
      method: 'POST',
      url: '/api/internal/affluence',
      headers: auth(),
      payload: {
        slots: [
          {
            location_id: '22222222-2222-4222-8222-222222222222',
            day_of_week: 1,
            hour: 24,
            estimated_impressions: 1,
          },
        ],
      },
    });
    expect(res.statusCode).toBe(400);
  });
});

// AUD-HOURLY1-A — the MEASURED per-(date, hour) receiver. STORAGE ONLY: nothing reads the table in
// this slice, so these tests describe the wire and the row, not any owner-facing number.
describe('C1h: POST /api/internal/affluence-hourly', () => {
  let app: ReturnType<typeof buildApp> | undefined;
  beforeEach(async () => {
    await resetAuthTables();
    app = buildApp();
    await app.ready();
  });
  afterEach(async () => {
    if (app) await app.close();
    app = undefined;
  });

  const seedVenue = async (name = 'Place H'): Promise<string> => {
    const [host] = await db.insert(screenhosts).values({ name }).returning({ id: screenhosts.id });
    return host!.id;
  };

  const push = (places: unknown, key = SYNC_KEY) =>
    app!.inject({
      method: 'POST',
      url: '/api/internal/affluence-hourly',
      headers: auth(key),
      payload: { places },
    });

  it("401 on a bad key — the guard is the siblings' guard", async () => {
    expect((await push([], 'wrong-key')).statusCode).toBe(401);
  });

  it('upserts the cells and re-upserts idempotently, latest value winning', async () => {
    const venue = await seedVenue();
    const first = await push([
      {
        toodooh_screenhost_id: venue,
        cells: [
          { date: '2026-08-31', hour: 14, value: 3 },
          { date: '2026-08-31', hour: 15, value: 7 },
        ],
      },
    ]);
    expect(first.statusCode).toBe(200);
    expect(
      first.json<{ upserted: number; slot_rows: number; unknown_locations: string[] }>(),
    ).toEqual({
      upserted: 2,
      slot_rows: 4, // MEJ-13-B — an hour-shaped cell writes BOTH halves
      unknown_locations: [],
    });

    // Same two cells again, one with a new value → still TWO rows, the newer value kept.
    const second = await push([
      {
        toodooh_screenhost_id: venue,
        cells: [
          { date: '2026-08-31', hour: 14, value: 5 },
          { date: '2026-08-31', hour: 15, value: 7 },
        ],
      },
    ]);
    expect(second.statusCode).toBe(200);
    expect(second.json<{ upserted: number }>().upserted).toBe(2);

    const rows = await db
      .select()
      .from(screenhostAffluenceHourly)
      .where(eq(screenhostAffluenceHourly.screenhostId, venue));
    // MEJ-13-B — two hour-shaped cells are FOUR half-hour rows; the cells themselves are the
    // distinct (hour, value) pairs.
    expect(rows).toHaveLength(4);
    expect(
      [...new Set(rows.map((r) => `${r.hour}|${r.value}`))]
        .sort()
        .map((k) => k.split('|').map(Number)),
    ).toEqual([
      [14, 5],
      [15, 7],
    ]);
  });

  // THE PIN (MEJ-5's sibling): a cell sent as 14 is stored as 14. The contract is Africa/Tunis and
  // toodooh stores it VERBATIM — a producer bucketing in UTC is fixed at the producer. This test
  // exists to fail the day someone "fixes" the timezone here instead of on the hub.
  it('stores date and hour VERBATIM — no timezone shifting api-side', async () => {
    const venue = await seedVenue();
    await push([
      {
        toodooh_screenhost_id: venue,
        cells: [
          { date: '2026-08-31', hour: 14, value: 3 }, // the ticket's own example
          { date: '2026-08-31', hour: 0, value: 1 }, // midnight — the wrap-prone edge
          { date: '2026-08-31', hour: 23, value: 2 }, // and the other one
        ],
      },
    ]);
    const rows = await db.select().from(screenhostAffluenceHourly);
    // MEJ-13-B — the verbatim contract is about the BUCKET, not the row count: each hour-shaped
    // cell is stored as both halves, so compare the distinct (date, hour, value) triples.
    expect(
      [
        ...new Map(
          rows.map((r) => [`${r.date}|${r.hour}`, [r.date, r.hour, r.value] as const]),
        ).values(),
      ].sort((a, b) => a[1] - b[1]),
    ).toEqual([
      ['2026-08-31', 0, 1],
      ['2026-08-31', 14, 3],
      ['2026-08-31', 23, 2],
    ]);
  });

  it('an unknown screenhost id is SKIPPED and reported, never fatal', async () => {
    const venue = await seedVenue();
    const unknownId = '11111111-1111-4111-8111-111111111111';
    const res = await push([
      { toodooh_screenhost_id: venue, cells: [{ date: '2026-08-31', hour: 9, value: 4 }] },
      { toodooh_screenhost_id: unknownId, cells: [{ date: '2026-08-31', hour: 9, value: 99 }] },
    ]);
    expect(res.statusCode).toBe(200);
    expect(
      res.json<{ upserted: number; slot_rows: number; unknown_locations: string[] }>(),
    ).toEqual({
      upserted: 1, // the known venue's cell landed
      slot_rows: 2, // MEJ-13-B — an hour-shaped cell writes BOTH halves
      unknown_locations: [unknownId],
    });
    const rows = await db.select().from(screenhostAffluenceHourly);
    expect(rows).toHaveLength(2); // MEJ-13-B — one hour-shaped cell, both halves
    expect(rows.every((r) => r.screenhostId === venue)).toBe(true);
  });

  it('400 on hour 24 and on a malformed / impossible date', async () => {
    const venue = await seedVenue();
    expect(
      (
        await push([
          { toodooh_screenhost_id: venue, cells: [{ date: '2026-08-31', hour: 24, value: 1 }] },
        ])
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await push([
          { toodooh_screenhost_id: venue, cells: [{ date: '31/08/2026', hour: 9, value: 1 }] },
        ])
      ).statusCode,
    ).toBe(400);
    // Regex-shaped but not a real day — would otherwise reach Postgres as a 500.
    expect(
      (
        await push([
          { toodooh_screenhost_id: venue, cells: [{ date: '2026-02-30', hour: 9, value: 1 }] },
        ])
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await push([
          { toodooh_screenhost_id: venue, cells: [{ date: '2026-08-31', hour: 9, value: -1 }] },
        ])
      ).statusCode,
    ).toBe(400);
    expect(await db.select().from(screenhostAffluenceHourly)).toHaveLength(0);
  });

  it('tolerates a cell repeated inside ONE batch (last wins, no conflict crash)', async () => {
    const venue = await seedVenue();
    const res = await push([
      {
        toodooh_screenhost_id: venue,
        cells: [
          { date: '2026-08-31', hour: 14, value: 3 },
          { date: '2026-08-31', hour: 14, value: 8 },
        ],
      },
    ]);
    expect(res.statusCode).toBe(200);
    expect(res.json<{ upserted: number }>().upserted).toBe(1); // deduped, not double-counted
    const rows = await db.select().from(screenhostAffluenceHourly);
    expect(rows).toHaveLength(2); // MEJ-13-B — both halves of the one deduped cell
    expect(rows.every((r) => r.value === 8)).toBe(true);
  });

  it('an empty batch is a 200 no-op', async () => {
    const res = await push([]);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ upserted: 0, unknown_locations: [] });
  });

  it('a venue delete cascades its hourly cells away', async () => {
    const venue = await seedVenue();
    await push([
      { toodooh_screenhost_id: venue, cells: [{ date: '2026-08-31', hour: 14, value: 3 }] },
    ]);
    await db.delete(screenhosts).where(eq(screenhosts.id, venue));
    expect(await db.select().from(screenhostAffluenceHourly)).toHaveLength(0);
  });
});

describe('C2: POST /api/internal/monthly-stats', () => {
  let app: ReturnType<typeof buildApp> | undefined;
  beforeEach(async () => {
    await resetAuthTables();
    app = buildApp();
    await app.ready();
  });
  afterEach(async () => {
    if (app) await app.close();
    app = undefined;
  });

  const stat = (locationId: string, totalAudience: number) => ({
    location_id: locationId,
    month: '2026-05',
    total_audience: totalAudience,
    daily: [
      { date: '2026-05-01', audience: 40 },
      { date: '2026-05-02', audience: 60 },
    ],
    peak_day_of_week: 6,
    peak_hour: 19,
  });

  it('upserts known stats and reports unknown location_ids (never fails the batch)', async () => {
    const [host] = await db
      .insert(screenhosts)
      .values({ name: 'Place A' })
      .returning({ id: screenhosts.id });
    const unknownId = '11111111-1111-4111-8111-111111111111';

    const first = await app!.inject({
      method: 'POST',
      url: '/api/internal/monthly-stats',
      headers: auth(),
      payload: { stats: [stat(host!.id, 1000), stat(unknownId, 500)] },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json<{ upserted: number; unknown_locations: string[] }>()).toEqual({
      upserted: 1,
      unknown_locations: [unknownId],
    });

    // Same (screenhost, month) again → latest-value-wins upsert (no duplicate row).
    const second = await app!.inject({
      method: 'POST',
      url: '/api/internal/monthly-stats',
      headers: auth(),
      payload: { stats: [stat(host!.id, 2500)] },
    });
    expect(second.statusCode).toBe(200);
    const rows = await db.select().from(screenhostMonthlyStats);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.totalAudience).toBe(2500);
    expect(rows[0]!.peakHour).toBe(19);
  });

  // PERF-QA2 — the merged audience source. « Personnes touchées » (Σ these rows) read 0 because
  // the hub's measured pipeline pushes zeros while the fleet is offline; a day with no
  // measurement now takes the venue's affluence estimate instead.
  it('fills UNMEASURED days from the venue affluence grid and recomputes the total', async () => {
    const [host] = await db
      .insert(screenhosts)
      .values({ name: 'Place Grille' })
      .returning({ id: screenhosts.id });
    // Mondays 10h → 100 (nothing else): every Monday of May 2026 estimates at 100.
    await db.insert(screenhostAffluence).values(
      bothHalves({
        screenhostId: host!.id,
        dayOfWeek: 1,
        hour: 10,
        estimatedImpressions: 100,
      }),
    );

    const res = await app!.inject({
      method: 'POST',
      url: '/api/internal/monthly-stats',
      headers: auth(),
      payload: {
        stats: [
          {
            location_id: host!.id,
            month: '2026-05',
            total_audience: 0, // the hub measured nothing, as always today
            daily: [{ date: '2026-05-04', audience: 250 }], // …except that one Monday
            peak_day_of_week: 1,
            peak_hour: 10,
          },
        ],
      },
    });
    expect(res.statusCode).toBe(200);

    const [row] = await db.select().from(screenhostMonthlyStats);
    // May 2026 has 4 Mondays; 04/05 is measured at 250, the other three estimate at 100 each.
    expect(row!.totalAudience).toBe(250 + 300);
    expect(row!.daily).toHaveLength(31);
    const measured = row!.daily.find((d) => d.date === '2026-05-04');
    expect(measured).toEqual({ date: '2026-05-04', audience: 250, source: 'measured' });
    expect(row!.daily.find((d) => d.date === '2026-05-11')).toEqual({
      date: '2026-05-11',
      audience: 100,
      source: 'estimated',
    });
  });

  it('stores a gridless venue EXACTLY as sent — nothing to estimate from', async () => {
    const [host] = await db
      .insert(screenhosts)
      .values({ name: 'Place Sans Grille' })
      .returning({ id: screenhosts.id });
    const res = await app!.inject({
      method: 'POST',
      url: '/api/internal/monthly-stats',
      headers: auth(),
      payload: { stats: [stat(host!.id, 1000)] },
    });
    expect(res.statusCode).toBe(200);
    const [row] = await db.select().from(screenhostMonthlyStats);
    expect(row!.totalAudience).toBe(1000); // the hub's own total, untouched
    expect(row!.daily).toHaveLength(2); // its own two days, unmarked
    expect(row!.daily[0]?.source).toBeUndefined();
  });

  it('400 on a malformed month', async () => {
    const res = await app!.inject({
      method: 'POST',
      url: '/api/internal/monthly-stats',
      headers: auth(),
      payload: {
        stats: [{ ...stat('22222222-2222-4222-8222-222222222222', 1), month: 'May-2026' }],
      },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('C3: POST /api/internal/screenhost-eligibility', () => {
  let app: ReturnType<typeof buildApp> | undefined;
  beforeEach(async () => {
    await resetAuthTables();
    app = buildApp();
    await app.ready();
  });
  afterEach(async () => {
    if (app) await app.close();
    app = undefined;
  });

  // Use a SEEDED owner-audience sector (migration 0003) so we never mutate the reference seed.
  const ownerSector = async () => {
    const [sector] = await db
      .select({ id: businessSectors.id, name: businessSectors.name })
      .from(businessSectors)
      .where(eq(businessSectors.audience, 'owner'))
      .limit(1);
    return sector!;
  };

  it('401 on a missing / wrong Bearer key', async () => {
    const missing = await app!.inject({
      method: 'POST',
      url: '/api/internal/screenhost-eligibility',
      payload: { items: [] },
    });
    expect(missing.statusCode).toBe(401);
    const wrong = await app!.inject({
      method: 'POST',
      url: '/api/internal/screenhost-eligibility',
      headers: auth('not-the-key-xxxxxxxx'),
      payload: { items: [] },
    });
    expect(wrong.statusCode).toBe(401);
  });

  it('upserts the row (resolves sector NAME → id, sets class + hours) and is latest-value-wins', async () => {
    const sector = await ownerSector();
    const [host] = await db
      .insert(screenhosts)
      .values({ name: 'Place A' })
      .returning({ id: screenhosts.id });

    const first = await app!.inject({
      method: 'POST',
      url: '/api/internal/screenhost-eligibility',
      headers: auth(),
      payload: {
        items: [
          {
            location_id: host!.id,
            business_sector: sector.name,
            class: 'moyen',
            opening_hour: 8,
            closing_hour: 22,
            broadcast_capacity: 4,
          },
        ],
      },
    });
    expect(first.statusCode).toBe(200);
    expect(
      first.json<{ upserted: number; unknown_locations: string[]; unknown_sectors: string[] }>(),
    ).toEqual({
      upserted: 1,
      unknown_locations: [],
      unknown_sectors: [],
    });

    const [row1] = await db
      .select({
        businessSectorId: screenhosts.businessSectorId,
        class: screenhosts.class,
        openingHour: screenhosts.openingHour,
        closingHour: screenhosts.closingHour,
        broadcastCapacity: screenhosts.broadcastCapacity,
      })
      .from(screenhosts)
      .where(eq(screenhosts.id, host!.id));
    expect(row1).toEqual({
      businessSectorId: sector.id,
      class: 'moyen',
      openingHour: 8,
      closingHour: 22,
      broadcastCapacity: 4,
    });

    // Re-push class only → latest-value-wins on class; omitted hours/capacity stay UNTOUCHED.
    const second = await app!.inject({
      method: 'POST',
      url: '/api/internal/screenhost-eligibility',
      headers: auth(),
      payload: { items: [{ location_id: host!.id, class: 'premium' }] },
    });
    expect(second.statusCode).toBe(200);
    const [row2] = await db
      .select({
        class: screenhosts.class,
        openingHour: screenhosts.openingHour,
        broadcastCapacity: screenhosts.broadcastCapacity,
      })
      .from(screenhosts)
      .where(eq(screenhosts.id, host!.id));
    expect(row2).toEqual({ class: 'premium', openingHour: 8, broadcastCapacity: 4 });
  });

  it('reports unknown location_ids AND unresolvable sector names (never fails the batch)', async () => {
    const [host] = await db
      .insert(screenhosts)
      .values({ name: 'Place B' })
      .returning({ id: screenhosts.id });
    const unknownId = '11111111-1111-4111-8111-111111111111';

    const res = await app!.inject({
      method: 'POST',
      url: '/api/internal/screenhost-eligibility',
      headers: auth(),
      payload: {
        items: [
          { location_id: host!.id, business_sector: 'No Such Sector', class: 'populaire' },
          { location_id: unknownId, class: 'moyen' },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{
      upserted: number;
      unknown_locations: string[];
      unknown_sectors: string[];
    }>();
    expect(body.upserted).toBe(1);
    expect(body.unknown_locations).toEqual([unknownId]);
    expect(body.unknown_sectors).toEqual(['No Such Sector']);

    // The class was still written; the unresolvable sector left businessSectorId NULL (untouched).
    const [row] = await db
      .select({ class: screenhosts.class, businessSectorId: screenhosts.businessSectorId })
      .from(screenhosts)
      .where(eq(screenhosts.id, host!.id));
    expect(row).toEqual({ class: 'populaire', businessSectorId: null });
  });

  it('400 on a bad item (class out of enum)', async () => {
    const res = await app!.inject({
      method: 'POST',
      url: '/api/internal/screenhost-eligibility',
      headers: auth(),
      payload: {
        items: [{ location_id: '22222222-2222-4222-8222-222222222222', class: 'gold' }],
      },
    });
    expect(res.statusCode).toBe(400);
  });

  // ── Lane D: the assigned class's demographic ratios ride the same C3 edge ──
  // CLS-AGE1 — the OLD four-bucket shape, kept on purpose: it is what the hub still sends until
  // its own half deploys, and the receiver must go on accepting it.
  const RATIOS = {
    gender_male_pct: 55.5,
    gender_female_pct: 44.5,
    age_17_30_pct: 30,
    age_31_45_pct: 40,
    age_46_60_pct: 20.25,
    age_60_plus_pct: 9.75,
  };
  /** The NEW three-bucket shape — 20.25 + 9.75 already merged by the hub. */
  const RATIOS_3 = {
    gender_male_pct: 55.5,
    gender_female_pct: 44.5,
    age_17_30_pct: 30,
    age_31_45_pct: 40,
    age_46_plus_pct: 30,
  };

  const selectRatios = async (id: string) => {
    const [row] = await db
      .select({
        genderMalePct: screenhosts.genderMalePct,
        genderFemalePct: screenhosts.genderFemalePct,
        age17To30Pct: screenhosts.age17To30Pct,
        age31To45Pct: screenhosts.age31To45Pct,
        age46PlusPct: screenhosts.age46PlusPct,
        class: screenhosts.class,
        businessSectorId: screenhosts.businessSectorId,
      })
      .from(screenhosts)
      .where(eq(screenhosts.id, id));
    return row!;
  };

  it('a ratios-ONLY item (no class/sector) stores the ratio columns; unknown locations still skipped', async () => {
    const [host] = await db
      .insert(screenhosts)
      .values({ name: 'Place R' })
      .returning({ id: screenhosts.id });
    const unknownId = '33333333-3333-4333-8333-333333333333';

    const res = await app!.inject({
      method: 'POST',
      url: '/api/internal/screenhost-eligibility',
      headers: auth(),
      payload: {
        items: [
          { location_id: host!.id, ratios: RATIOS },
          { location_id: unknownId, ratios: RATIOS }, // unknown → skipped + reported, never written
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ upserted: number; unknown_locations: string[] }>();
    expect(body.upserted).toBe(1);
    expect(body.unknown_locations).toEqual([unknownId]);

    const row = await selectRatios(host!.id);
    // Drizzle numeric → JS string; Number() the stored values (the lat/lng convention).
    expect(Number(row.genderMalePct)).toBeCloseTo(55.5, 2);
    expect(Number(row.genderFemalePct)).toBeCloseTo(44.5, 2);
    expect(Number(row.age17To30Pct)).toBeCloseTo(30, 2);
    expect(Number(row.age31To45Pct)).toBeCloseTo(40, 2);
    // CLS-AGE1 — the two retired buckets arrive and are SUMMED into the one column.
    expect(Number(row.age46PlusPct)).toBeCloseTo(30, 2);
    // A ratios-only item touches nothing else.
    expect(row.class).toBeNull();
    expect(row.businessSectorId).toBeNull();
  });

  it('absent ratios key → the ratio columns untouched; explicit null → cleared', async () => {
    const [host] = await db
      .insert(screenhosts)
      .values({ name: 'Place S' })
      .returning({ id: screenhosts.id });
    const post = (item: Record<string, unknown>) =>
      app!.inject({
        method: 'POST',
        url: '/api/internal/screenhost-eligibility',
        headers: auth(),
        payload: { items: [{ location_id: host!.id, ...item }] },
      });

    await post({ ratios: RATIOS });
    // Re-push WITHOUT the ratios key (class only) → ratios stay.
    expect((await post({ class: 'moyen' })).statusCode).toBe(200);
    const afterAbsent = await selectRatios(host!.id);
    expect(Number(afterAbsent.genderMalePct)).toBeCloseTo(55.5, 2);
    expect(Number(afterAbsent.age46PlusPct)).toBeCloseTo(30, 2); // CLS-AGE1 — 20.25 + 9.75
    expect(afterAbsent.class).toBe('moyen');

    // Explicit null → all six cleared; the other columns stay.
    expect((await post({ ratios: null })).statusCode).toBe(200);
    const afterNull = await selectRatios(host!.id);
    expect(afterNull.genderMalePct).toBeNull();
    expect(afterNull.genderFemalePct).toBeNull();
    expect(afterNull.age17To30Pct).toBeNull();
    expect(afterNull.age31To45Pct).toBeNull();
    expect(afterNull.age46PlusPct).toBeNull();
    expect(afterNull.class).toBe('moyen');
  });

  // ── CLS-AGE1 — BOTH shapes, because the hub has no interim ────────────────────────────────
  //
  // Its C3 push is generic over its field constant: six fields until it deploys, five after, no
  // middle state. And this validator 400s the WHOLE batch on one bad item, so refusing the old
  // shape would take eligibility down for every venue in the window between the two deploys.
  it('CLS-AGE1: a FOUR-bucket push and a THREE-bucket push of the same class store the same value', async () => {
    const [a] = await db
      .insert(screenhosts)
      .values({ name: 'Four' })
      .returning({ id: screenhosts.id });
    const [b] = await db
      .insert(screenhosts)
      .values({ name: 'Three' })
      .returning({ id: screenhosts.id });
    const send = (id: string, ratios: unknown) =>
      app!.inject({
        method: 'POST',
        url: '/api/internal/screenhost-eligibility',
        headers: auth(),
        payload: { items: [{ location_id: id, ratios }] },
      });

    expect((await send(a!.id, RATIOS)).statusCode).toBe(200); // the hub, today
    expect((await send(b!.id, RATIOS_3)).statusCode).toBe(200); // the hub, after its deploy

    const four = await selectRatios(a!.id);
    const three = await selectRatios(b!.id);
    expect(Number(four.age46PlusPct)).toBeCloseTo(30, 2); // 20.25 + 9.75, summed on arrival
    expect(Number(four.age46PlusPct)).toBeCloseTo(Number(three.age46PlusPct), 2);
  });

  it('CLS-AGE1: a ratios object with NEITHER the new field nor both old ones is a 400', async () => {
    const [sh] = await db
      .insert(screenhosts)
      .values({ name: 'Half' })
      .returning({ id: screenhosts.id });
    const res = await app!.inject({
      method: 'POST',
      url: '/api/internal/screenhost-eligibility',
      headers: auth(),
      payload: {
        items: [
          {
            location_id: sh!.id,
            // 46–60 without 60+: half a merge, which would silently under-count the band.
            ratios: {
              gender_male_pct: 50,
              gender_female_pct: 50,
              age_17_30_pct: 30,
              age_31_45_pct: 40,
              age_46_60_pct: 20,
            },
          },
        ],
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('400 on a partial ratios object and on an out-of-range ratio', async () => {
    const id = '22222222-2222-4222-8222-222222222222';
    const partial = await app!.inject({
      method: 'POST',
      url: '/api/internal/screenhost-eligibility',
      headers: auth(),
      payload: { items: [{ location_id: id, ratios: { gender_male_pct: 50 } }] },
    });
    expect(partial.statusCode).toBe(400);

    const outOfRange = await app!.inject({
      method: 'POST',
      url: '/api/internal/screenhost-eligibility',
      headers: auth(),
      payload: { items: [{ location_id: id, ratios: { ...RATIOS, gender_male_pct: 100.01 } }] },
    });
    expect(outOfRange.statusCode).toBe(400);
  });
});

describe('Edge A: POST /api/internal/agents', () => {
  let app: ReturnType<typeof buildApp> | undefined;
  beforeEach(async () => {
    await resetAuthTables();
    app = buildApp();
    await app.ready();
  });
  afterEach(async () => {
    if (app) await app.close();
    app = undefined;
  });

  it('provisions a screenhost_agent + SH-prefixed code, and replays idempotently', async () => {
    const create = await app!.inject({
      method: 'POST',
      url: '/api/internal/agents',
      headers: auth(),
      payload: {
        email: 'agent@example.com',
        contact_name: 'Field Agent',
        password: 'longenoughpw123',
      },
    });
    expect(create.statusCode).toBe(201);
    const first = create.json<{ user_id: string; code: string }>();
    expect(first.code).toMatch(/^SH\d{6}$/); // Edge A always provisions a screenhost_agent
    const [agentRow] = await db.select().from(agents).where(eq(agents.userId, first.user_id));
    expect(agentRow?.code).toBe(first.code);

    // Replay same email → 200 with the SAME id + code (no duplicate).
    const replay = await app!.inject({
      method: 'POST',
      url: '/api/internal/agents',
      headers: auth(),
      payload: { email: 'AGENT@example.com', contact_name: 'Field Agent' },
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json<{ user_id: string; code: string }>()).toEqual(first);
  });

  it('409 EMAIL_TAKEN when the email belongs to a non-agent role', async () => {
    await db
      .insert(users)
      .values({ email: 'taken@example.com', contactName: 'Advertiser', role: 'advertiser' });
    const res = await app!.inject({
      method: 'POST',
      url: '/api/internal/agents',
      headers: auth(),
      payload: { email: 'taken@example.com', contact_name: 'X', password: 'longenoughpw123' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json<{ error: string }>().error).toBe('EMAIL_TAKEN');
  });
});
