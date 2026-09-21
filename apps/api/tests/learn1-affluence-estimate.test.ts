import { asc, eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { db, sql } from '../src/db/client.js';
import { screenhostAffluenceHourly, screenhosts } from '../src/db/schema.js';
import { firstMeasuredDay, loadBackupGrid } from '../src/lib/period-audience-source.js';
import { venueHasAffluenceSql } from '../src/lib/venue-has-affluence.js';
import { internalRoutes } from '../src/routes/internal.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// LEARN-1 T2 (spec 2026-09-21 §5) — the hub's READY-MADE value for a half-hour it did not measure
// (its learned average, else the typed seed) lives in its OWN column, beside `value = NULL`, so an
// estimate can never be read as a measurement. Nullable (absent = the hub offered nothing, and every
// row written before LEARN-1), never negative.

const seedVenue = async (name = 'LEARN-1 venue'): Promise<string> => {
  const [host] = await db.insert(screenhosts).values({ name }).returning({ id: screenhosts.id });
  return host!.id;
};

// The /api/internal/* surface takes the key as a plugin option (internal.test.ts idiom), so no env.
const SYNC_KEY = 'test-sync-key-0123456789';
const auth = { authorization: `Bearer ${SYNC_KEY}` };
const buildApp = () => {
  const app = Fastify({ logger: false });
  app.register(internalRoutes, { syncKey: SYNC_KEY });
  return app;
};

afterAll(async () => {
  await sql.end();
});

describe('LEARN-1 T2 — screenhost_affluence_hourly.estimate (migration 0077)', () => {
  beforeEach(async () => {
    await resetAuthTables();
  });

  it('is a NULLABLE integer', async () => {
    const [col] = await sql<{ is_nullable: string; data_type: string }[]>`
      select is_nullable, data_type from information_schema.columns
      where table_name = 'screenhost_affluence_hourly' and column_name = 'estimate'`;
    expect(col).toEqual({ is_nullable: 'YES', data_type: 'integer' });
  });

  it('refuses a negative estimate at the database; NULL and 0 pass', async () => {
    const venue = await seedVenue();
    await db.insert(screenhostAffluenceHourly).values([
      { screenhostId: venue, date: '2026-09-14', hour: 10, slot: 20, value: null, estimate: 0 },
      { screenhostId: venue, date: '2026-09-14', hour: 10, slot: 21, value: 5 }, // estimate NULL
    ]);
    await expect(
      sql`insert into screenhost_affluence_hourly (screenhost_id, date, hour, slot, value, estimate)
          values (${venue}, '2026-09-14', 11, 22, null, -1)`,
    ).rejects.toThrow(/screenhost_affluence_hourly_estimate_nonneg/);
  });
});

describe('LEARN-1 T2 — C1h stores the estimate (receiver contract)', () => {
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

  const push = (places: unknown) =>
    app!.inject({
      method: 'POST',
      url: '/api/internal/affluence-hourly',
      headers: auth,
      payload: { places },
    });

  const rowsOf = (venue: string) =>
    db
      .select({
        slot: screenhostAffluenceHourly.slot,
        value: screenhostAffluenceHourly.value,
        estimate: screenhostAffluenceHourly.estimate,
        deviceOnline: screenhostAffluenceHourly.deviceOnline,
      })
      .from(screenhostAffluenceHourly)
      .where(eq(screenhostAffluenceHourly.screenhostId, venue))
      .orderBy(asc(screenhostAffluenceHourly.slot));

  it("stores `estimate` beside a null value — the flagged hub's exact cell (no hour, no device_online)", async () => {
    const venue = await seedVenue();
    const res = await push([
      {
        toodooh_screenhost_id: venue,
        cells: [
          { date: '2026-09-14', slot: 18, value: 12 },
          { date: '2026-09-14', slot: 20, value: null, estimate: 30 },
        ],
      },
    ]);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ upserted: 2, slot_rows: 2, unknown_locations: [] });
    expect(await rowsOf(venue)).toEqual([
      { slot: 18, value: 12, estimate: null, deviceOnline: null },
      { slot: 20, value: null, estimate: 30, deviceOnline: null },
    ]);
  });

  it('a later push WITHOUT estimate clears it — measured since, or nothing to offer any more', async () => {
    const venue = await seedVenue();
    await push([
      {
        toodooh_screenhost_id: venue,
        cells: [
          { date: '2026-09-14', slot: 20, value: null, estimate: 30 },
          { date: '2026-09-14', slot: 21, value: null, estimate: 30 },
        ],
      },
    ]);
    const res = await push([
      {
        toodooh_screenhost_id: venue,
        cells: [
          { date: '2026-09-14', slot: 20, value: 7 }, // the sensor's late reading landed
          { date: '2026-09-14', slot: 21, value: null }, // the hub has no value for it any more
        ],
      },
    ]);
    expect(res.statusCode).toBe(200);
    expect(await rowsOf(venue)).toEqual([
      { slot: 20, value: 7, estimate: null, deviceOnline: null },
      { slot: 21, value: null, estimate: null, deviceOnline: null },
    ]);
  });

  it('400 on a negative or non-integer estimate — nothing of the batch is written', async () => {
    const venue = await seedVenue();
    for (const estimate of [-1, 2.5]) {
      const res = await push([
        {
          toodooh_screenhost_id: venue,
          cells: [
            { date: '2026-09-14', slot: 18, value: 12 },
            { date: '2026-09-14', slot: 20, value: null, estimate },
          ],
        },
      ]);
      expect(res.statusCode).toBe(400);
      expect(res.json<{ error: string }>().error).toBe('INVALID_INPUT');
    }
    expect(await rowsOf(venue)).toEqual([]);
  });

  it('an hour-shaped cell carries its estimate onto BOTH halves (MEJ-13-B rule 2)', async () => {
    const venue = await seedVenue();
    const res = await push([
      {
        toodooh_screenhost_id: venue,
        cells: [{ date: '2026-09-14', hour: 10, value: null, estimate: 30 }],
      },
    ]);
    expect(res.json()).toEqual({ upserted: 1, slot_rows: 2, unknown_locations: [] });
    expect(await rowsOf(venue)).toEqual([
      { slot: 20, value: null, estimate: 30, deviceOnline: null },
      { slot: 21, value: null, estimate: 30, deviceOnline: null },
    ]);
  });
});

describe('LEARN-1 T2 — the measured-only readers never see an estimate (pins)', () => {
  beforeEach(async () => {
    await resetAuthTables();
  });

  it('firstMeasuredDay skips a date that holds only estimates', async () => {
    const venue = await seedVenue();
    await db.insert(screenhostAffluenceHourly).values([
      { screenhostId: venue, date: '2026-09-07', hour: 10, slot: 20, value: null, estimate: 30 },
      { screenhostId: venue, date: '2026-09-14', hour: 9, slot: 18, value: 12 },
    ]);
    expect(await firstMeasuredDay(venue)).toBe('2026-09-14');
  });

  it('venueHasAffluenceSql is FALSE for a venue whose only hub cells are estimates', async () => {
    const venue = await seedVenue();
    await db.insert(screenhostAffluenceHourly).values({
      screenhostId: venue,
      date: '2026-09-07',
      hour: 10,
      slot: 20,
      value: null,
      estimate: 30,
    });
    const [row] = await db
      .select({ has: venueHasAffluenceSql() })
      .from(screenhosts)
      .where(eq(screenhosts.id, venue));
    expect(row?.has).toBe(false);
  });
});

describe('LEARN-1 T4 — the full-grid typical week needs no receiver change (contract pin)', () => {
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

  it('336 keys in ONE request are accepted; the withdrawn ones read as ABSENT in the backup grid', async () => {
    const venue = await seedVenue();
    const learned = new Set([20, 21, 22, 23]); // Monday 10h00–11h30 — the only cells the rule produces
    const slots: {
      location_id: string;
      day_of_week: number;
      slot: number;
      estimated_impressions: number;
      source: 'measured' | 'backup';
      in_effect: boolean;
    }[] = [];
    for (let day = 1; day <= 7; day += 1) {
      for (let slot = 0; slot < 48; slot += 1) {
        const present = day === 1 && learned.has(slot);
        slots.push({
          location_id: venue,
          day_of_week: day,
          slot,
          estimated_impressions: present ? 40 : 0,
          source: present ? 'measured' : 'backup',
          in_effect: present,
        });
      }
    }
    const res = await app!.inject({
      method: 'POST',
      url: '/api/internal/affluence',
      headers: auth,
      payload: { slots },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ upserted: 336, slot_rows: 336, unknown_locations: [] });

    const grid = await loadBackupGrid(venue);
    const filled: [number, number][] = [];
    grid.has.forEach((row, day) =>
      row.forEach((has, slot) => {
        if (has) filled.push([day, slot]);
      }),
    );
    expect(filled).toEqual([
      [0, 20],
      [0, 21],
      [0, 22],
      [0, 23],
    ]);
    expect(grid.values[0]?.[20]).toBe(40);
  });
});
