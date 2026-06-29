import { eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { db, sql } from '../src/db/client.js';
import {
  agents,
  businessSectors,
  governorates,
  screenhostAffluence,
  screenhostMonthlyStats,
  screenhosts,
  screens,
  users,
} from '../src/db/schema.js';
import { encryptWifiPassword } from '../src/lib/wifi-crypto.js';
import { internalRoutes } from '../src/routes/internal.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

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
    expect(first.json<{ upserted: number; unknown_locations: string[] }>()).toEqual({
      upserted: 1,
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
    expect(rows).toHaveLength(1);
    expect(rows[0]!.estimatedImpressions).toBe(250);
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
