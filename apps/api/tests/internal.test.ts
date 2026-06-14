import { eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { db, sql } from '../src/db/client.js';
import {
  agents,
  governorates,
  screenhostAffluence,
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

  it('provisions a screenhost_agent + 8-digit code, and replays idempotently', async () => {
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
    expect(first.code).toMatch(/^\d{8}$/);
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
