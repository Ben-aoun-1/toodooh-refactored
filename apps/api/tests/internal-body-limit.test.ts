import { addDays, format, parseISO } from 'date-fns';
import { count, eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { db, sql } from '../src/db/client.js';
import { screenhostAffluenceHourly, screenhosts } from '../src/db/schema.js';
import { internalRoutes } from '../src/routes/internal.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// HUB-413 — the body ceiling of the hub's batch ingest routes. From 2026-09-12 every
// affluence-hourly push died on 413 FST_ERR_CTP_BODY_TOO_LARGE: Fastify's default 1 MiB was the
// real limit behind nginx's 20m, and the hub's boot push (every place, the whole 35-day window,
// 48 cells a day, empty ones included) passed it at ~10 places. These tests pin three facts:
//   1. an incident-sized push is ACCEPTED and UPSERTED — the fixture proves its own size;
//   2. the raise did not open the door — no key is still a 401, and 20 MiB is still a ceiling;
//   3. the raise is SCOPED — the one-row-a-place routes keep Fastify's 1 MiB.

const SYNC_KEY = 'test-sync-key-0123456789';
const MIB = 1024 * 1024;
const FASTIFY_DEFAULT_LIMIT = MIB;
const NGINX_LIMIT = 20 * MIB; // infra/nginx/*.conf — client_max_body_size 20m

const json = { 'content-type': 'application/json' };
const authed = { ...json, authorization: `Bearer ${SYNC_KEY}` };

const buildApp = () => {
  const app = Fastify({ logger: false });
  app.register(internalRoutes, { syncKey: SYNC_KEY });
  return app;
};

// The hub's boot window, as a FIXED fixture (no wall clock): 35 Tunis dates.
const WINDOW_DAYS = 35;
const DATES = Array.from({ length: WINDOW_DAYS }, (_, i) =>
  format(addDays(parseISO('2026-08-08'), i), 'yyyy-MM-dd'),
);
const CELLS_PER_PLACE = WINDOW_DAYS * 48;
// 12 places in all — the incident crossed 1 MiB at ~10, so 12 keeps a margin above it. Only 3 are
// seeded: an unknown place is parsed and validated like any other but writes nothing (skipped and
// reported), which keeps the test fast without shrinking the body.
const KNOWN_PLACES = 3;
const UNKNOWN_IDS = Array.from(
  { length: 9 },
  (_, i) => `11111111-1111-4111-8111-${String(i + 1).padStart(12, '0')}`,
);

/** One place's cells in the hub's OFF-1 shape: a measured slot, or an empty one + device_online. */
const placeCells = (): unknown[] =>
  DATES.flatMap((date) =>
    Array.from({ length: 48 }, (_, slot) =>
      slot % 3 === 0
        ? { date, slot, value: 40 + slot }
        : { date, slot, value: null, device_online: slot % 2 === 0 },
    ),
  );

const bootPush = (venueIds: readonly string[]): string =>
  JSON.stringify({
    places: venueIds.map((id) => ({ toodooh_screenhost_id: id, cells: placeCells() })),
  });

/** A schema-valid body past `bytes`: the empty batch plus a key zod strips before the handler. */
const padded = (batchKey: string, bytes: number): string =>
  JSON.stringify({ [batchKey]: [], pad: 'x'.repeat(bytes) });

const seedVenues = async (n: number): Promise<string[]> => {
  const rows = await db
    .insert(screenhosts)
    .values(Array.from({ length: n }, (_, i) => ({ name: `HUB-413 Venue ${i + 1}` })))
    .returning({ id: screenhosts.id });
  return rows.map((r) => r.id);
};

const hourlyRowCount = async (): Promise<number> => {
  const [row] = await db.select({ n: count() }).from(screenhostAffluenceHourly);
  return row?.n ?? 0;
};

// The three routes that carry a per-place series, and the key their batch lives under.
const RAISED = [
  { url: '/api/internal/affluence', batchKey: 'slots' },
  { url: '/api/internal/affluence-hourly', batchKey: 'places' },
  { url: '/api/internal/monthly-stats', batchKey: 'stats' },
] as const;

afterAll(async () => {
  await sql.end();
});

describe('HUB-413 — the hub batch ingest routes accept up to 20 MiB, like nginx', () => {
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

  it("THE INCIDENT: a 35-day boot push for 12 places, past Fastify's 1 MiB, lands whole", async () => {
    const venues = await seedVenues(KNOWN_PLACES);
    // The seeded venues go LAST, so the rows checked below come from the tail of the body.
    const payload = bootPush([...UNKNOWN_IDS, ...venues]);
    // The fixture must really be the incident's size, or this test proves nothing.
    expect(Buffer.byteLength(payload)).toBeGreaterThan(FASTIFY_DEFAULT_LIMIT);

    const res = await app!.inject({
      method: 'POST',
      url: '/api/internal/affluence-hourly',
      headers: authed,
      payload,
    });
    expect(res.statusCode).toBe(200);
    expect(
      res.json<{ upserted: number; slot_rows: number; unknown_locations: string[] }>(),
    ).toEqual({
      upserted: KNOWN_PLACES * CELLS_PER_PLACE,
      slot_rows: KNOWN_PLACES * CELLS_PER_PLACE,
      unknown_locations: UNKNOWN_IDS,
    });
    expect(await hourlyRowCount()).toBe(KNOWN_PLACES * CELLS_PER_PLACE);

    // Spot-check both cell kinds on the LAST place and the LAST date — the very end of the body.
    const last = venues[venues.length - 1] ?? '';
    const lastDate = DATES[DATES.length - 1] ?? '';
    const tail = await db
      .select({
        date: screenhostAffluenceHourly.date,
        slot: screenhostAffluenceHourly.slot,
        value: screenhostAffluenceHourly.value,
        deviceOnline: screenhostAffluenceHourly.deviceOnline,
      })
      .from(screenhostAffluenceHourly)
      .where(eq(screenhostAffluenceHourly.screenhostId, last));
    expect(tail).toHaveLength(CELLS_PER_PLACE);
    expect(tail.find((r) => r.date === lastDate && r.slot === 45)).toEqual({
      date: lastDate,
      slot: 45,
      value: 85, // a measured cell (45 % 3 === 0)
      deviceOnline: null,
    });
    expect(tail.find((r) => r.date === lastDate && r.slot === 47)).toEqual({
      date: lastDate,
      slot: 47,
      value: null, // an empty cell stays « the sensor said nothing », not a zero
      deviceOnline: false,
    });
  });

  it('the same incident-sized push WITHOUT the key is still a 401, and writes nothing', async () => {
    const payload = bootPush([...UNKNOWN_IDS, ...(await seedVenues(KNOWN_PLACES))]);
    expect(Buffer.byteLength(payload)).toBeGreaterThan(FASTIFY_DEFAULT_LIMIT);
    const missing = await app!.inject({
      method: 'POST',
      url: '/api/internal/affluence-hourly',
      headers: json,
      payload,
    });
    expect(missing.statusCode).toBe(401);
    const wrong = await app!.inject({
      method: 'POST',
      url: '/api/internal/affluence-hourly',
      headers: { ...json, authorization: 'Bearer not-the-key-xxxxxxxx' },
      payload,
    });
    expect(wrong.statusCode).toBe(401);
    expect(await hourlyRowCount()).toBe(0);
  });

  it.each(RAISED)(
    '$url — a body past 1 MiB is a 200 with the key, a 401 without',
    async (route) => {
      const payload = padded(route.batchKey, Math.ceil(1.5 * MIB));
      const ok = await app!.inject({ method: 'POST', url: route.url, headers: authed, payload });
      expect(ok.statusCode).toBe(200);
      expect(ok.json<{ upserted: number }>().upserted).toBe(0);

      const denied = await app!.inject({ method: 'POST', url: route.url, headers: json, payload });
      expect(denied.statusCode).toBe(401);
    },
  );

  it("20 MiB is still a ceiling: a body just past nginx's limit is a 413 on every raised route", async () => {
    const payload = padded('places', NGINX_LIMIT); // the envelope pushes it just past 20 MiB
    expect(Buffer.byteLength(payload)).toBeGreaterThan(NGINX_LIMIT);
    for (const route of RAISED) {
      const res = await app!.inject({ method: 'POST', url: route.url, headers: authed, payload });
      expect(res.statusCode, route.url).toBe(413);
    }
  });

  it("the raise is scoped: the one-row-a-place routes keep Fastify's 1 MiB", async () => {
    const payload = padded('items', Math.ceil(1.5 * MIB));
    for (const url of ['/api/internal/screenhost-eligibility', '/api/internal/agents']) {
      const res = await app!.inject({ method: 'POST', url, headers: authed, payload });
      expect(res.statusCode, url).toBe(413);
    }
  });
});
