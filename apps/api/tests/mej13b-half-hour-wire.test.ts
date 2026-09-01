import { asc, eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { db, sql } from '../src/db/client.js';
import {
  type NewUser,
  screenhostAffluence,
  screenhostAffluenceHourly,
  screenhosts,
  users,
} from '../src/db/schema.js';
import { loadBackupGrid } from '../src/lib/period-audience-source.js';
import { internalRoutes } from '../src/routes/internal.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// MEJ-13-B — THE WIRE. Both endpoints gained an optional `slot` (0–47) and both tables are keyed
// on it. The receiver rule, and the reason each clause exists:
//   1. slot present            → verbatim.
//   2. slot absent, hour set   → BOTH halves, SAME value. A cell is a LEVEL (people present), so
//                                half an hour of it is not half the people. Never v/2.
//   3. both present            → slot wins, hour ignored, NO error: the sender is mid-roll.
//   4. neither                 → 400.
// Rule 2 is what lets the two boxes deploy in either order, and THE acceptance test for the whole
// programme is the last describe: an old-shape push and a new-shape push of the same week must
// produce identical numbers.

const SYNC_KEY = 'test-sync-key-0123456789';
const auth = { authorization: `Bearer ${SYNC_KEY}` };

let seq = 0;
const seedVenue = async (): Promise<string> => {
  seq += 1;
  const values: NewUser = {
    email: `mej13b${seq}@example.com`,
    contactName: `Owner ${seq}`,
    role: 'individual_owner',
    status: 'approved',
  };
  const [owner] = await db.insert(users).values(values).returning();
  const [sh] = await db
    .insert(screenhosts)
    .values({ name: `MEJ13B Venue ${seq}`, ownerId: owner?.id ?? '' })
    .returning();
  return sh?.id ?? '';
};

const buildApp = () => {
  const app = Fastify({ logger: false });
  app.register(internalRoutes, { syncKey: SYNC_KEY });
  return app;
};

const rowsFor = async (venue: string) =>
  db
    .select({
      dayOfWeek: screenhostAffluence.dayOfWeek,
      hour: screenhostAffluence.hour,
      slot: screenhostAffluence.slot,
      estimatedImpressions: screenhostAffluence.estimatedImpressions,
      source: screenhostAffluence.source,
    })
    .from(screenhostAffluence)
    .where(eq(screenhostAffluence.screenhostId, venue))
    .orderBy(asc(screenhostAffluence.slot));

describe('MEJ-13-B — the half-hour receiver rule', () => {
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

  const push = async (slots: unknown[]) =>
    app!.inject({
      method: 'POST',
      url: '/api/internal/affluence',
      headers: auth,
      payload: { slots },
    });

  it('rule 2 — an hour-shaped cell writes BOTH halves with the SAME value, never v/2', async () => {
    const venue = await seedVenue();
    const res = await push([
      {
        location_id: venue,
        day_of_week: 1,
        hour: 13,
        estimated_impressions: 1396,
        source: 'backup',
      },
    ]);
    expect(res.statusCode).toBe(200);

    const rows = await rowsFor(venue);
    expect(rows.map((r) => r.slot)).toEqual([26, 27]);
    // THE point of the rule: the level is carried into both halves, not divided between them.
    expect(rows.map((r) => r.estimatedImpressions)).toEqual([1396, 1396]);
    expect(rows.every((r) => r.hour === 13)).toBe(true);
    expect(rows.every((r) => r.source === 'backup')).toBe(true);
  });

  it('rule 1 — a slot-shaped cell is stored verbatim, and only that slot', async () => {
    const venue = await seedVenue();
    await push([{ location_id: venue, day_of_week: 2, slot: 27, estimated_impressions: 700 }]);

    const rows = await rowsFor(venue);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.slot).toBe(27);
    expect(rows[0]?.hour).toBe(13); // DERIVED from the slot
    expect(rows[0]?.estimatedImpressions).toBe(700);
  });

  it('rule 3 — both present: slot wins, hour is ignored, and it is NOT an error', async () => {
    const venue = await seedVenue();
    // A mid-roll sender: the slot says 13:30, the stale hour field says 05:00.
    const res = await push([
      { location_id: venue, day_of_week: 3, hour: 5, slot: 27, estimated_impressions: 42 },
    ]);
    expect(res.statusCode).toBe(200); // no reconciliation, no complaint

    const rows = await rowsFor(venue);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.slot).toBe(27);
    // The stored hour comes from the SLOT — the DB CHECK `hour = slot / 2` makes any other
    // outcome unstorable, so the two keys can never disagree on disk.
    expect(rows[0]?.hour).toBe(13);
  });

  it('rule 4 — neither hour nor slot is a 400, naming the field', async () => {
    const venue = await seedVenue();
    const res = await push([{ location_id: venue, day_of_week: 1, estimated_impressions: 10 }]);
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toBe('INVALID_INPUT');
    expect(await rowsFor(venue)).toHaveLength(0);
  });

  it('an explicit slot beats an hour-expansion for the same slot WITHIN one batch', async () => {
    const venue = await seedVenue();
    // A sender rolling forward cell by cell can emit both shapes in one push. Rule 3 says slot
    // wins inside a cell; the same must hold across cells, or the roll-forward is undone by
    // whichever cell happens to be ordered last.
    await push([
      { location_id: venue, day_of_week: 1, slot: 27, estimated_impressions: 900 },
      { location_id: venue, day_of_week: 1, hour: 13, estimated_impressions: 100 },
    ]);
    const rows = await rowsFor(venue);
    expect(rows.find((r) => r.slot === 27)?.estimatedImpressions).toBe(900); // explicit survived
    expect(rows.find((r) => r.slot === 26)?.estimatedImpressions).toBe(100); // the other half filled
  });

  it('re-pushing the same cell is idempotent on the new key (latest value wins)', async () => {
    const venue = await seedVenue();
    await push([{ location_id: venue, day_of_week: 1, hour: 8, estimated_impressions: 10 }]);
    await push([{ location_id: venue, day_of_week: 1, hour: 8, estimated_impressions: 25 }]);
    const rows = await rowsFor(venue);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.estimatedImpressions)).toEqual([25, 25]);
  });
});

describe('MEJ-13-B — the hourly (measured) endpoint follows the same rule', () => {
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

  it('an hour-shaped cell expands to both halves; a slot-shaped one is verbatim', async () => {
    const venue = await seedVenue();
    const res = await app!.inject({
      method: 'POST',
      url: '/api/internal/affluence-hourly',
      headers: auth,
      payload: {
        places: [
          {
            toodooh_screenhost_id: venue,
            cells: [
              { date: '2026-08-31', hour: 13, value: 380 },
              { date: '2026-08-31', slot: 40, value: 55 },
            ],
          },
        ],
      },
    });
    expect(res.statusCode).toBe(200);

    const rows = await db
      .select({
        slot: screenhostAffluenceHourly.slot,
        hour: screenhostAffluenceHourly.hour,
        value: screenhostAffluenceHourly.value,
      })
      .from(screenhostAffluenceHourly)
      .where(eq(screenhostAffluenceHourly.screenhostId, venue))
      .orderBy(asc(screenhostAffluenceHourly.slot));
    expect(rows.map((r) => [r.slot, r.value])).toEqual([
      [26, 380],
      [27, 380],
      [40, 55],
    ]);
    expect(rows.map((r) => r.hour)).toEqual([13, 13, 20]);
  });
});

// ── THE ACCEPTANCE TEST FOR THE PROGRAMME ────────────────────────────────────────────────────
describe('MEJ-13-B — an old-shape push and a new-shape push agree, cell for cell', () => {
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

  /** A whole typical week, the shape the hub actually pushes. */
  const week = (venue: string, shaped: 'hour' | 'slot'): unknown[] => {
    const cells: unknown[] = [];
    for (let dow = 1; dow <= 7; dow += 1) {
      for (let hour = 0; hour < 24; hour += 1) {
        const value = dow * 100 + hour; // distinct per cell, so a mix-up cannot cancel out
        if (shaped === 'hour') {
          cells.push({
            location_id: venue,
            day_of_week: dow,
            hour,
            estimated_impressions: value,
            source: 'measured',
          });
        } else {
          // The hub, post-slice-B: both halves of the same hour, same level.
          for (const slot of [hour * 2, hour * 2 + 1]) {
            cells.push({
              location_id: venue,
              day_of_week: dow,
              slot,
              estimated_impressions: value,
              source: 'measured',
            });
          }
        }
      }
    }
    return cells;
  };

  it('THE INVARIANT: the merged 7×24 grid is IDENTICAL either way', async () => {
    const oldVenue = await seedVenue();
    const newVenue = await seedVenue();

    await app!.inject({
      method: 'POST',
      url: '/api/internal/affluence',
      headers: auth,
      payload: { slots: week(oldVenue, 'hour') },
    });
    await app!.inject({
      method: 'POST',
      url: '/api/internal/affluence',
      headers: auth,
      payload: { slots: week(newVenue, 'slot') },
    });

    // Both venues hold 336 rows — the old shape was EXPANDED, not halved.
    expect(await rowsFor(oldVenue)).toHaveLength(7 * 48);
    expect(await rowsFor(newVenue)).toHaveLength(7 * 48);

    // And the grid every hour-keyed consumer reads (dispatch Ai, A_max, monthly audience, the
    // owner wire, the PDF) is the same for both, cell for cell.
    const oldGrid = await loadBackupGrid(oldVenue);
    const newGrid = await loadBackupGrid(newVenue);
    expect(oldGrid.values).toEqual(newGrid.values);
    expect(oldGrid.has).toEqual(newGrid.has);

    // …and it still carries the ORIGINAL numbers, not doubled and not halved.
    expect(oldGrid.values[0]?.[13]).toBe(113); // dow 1, hour 13
    expect(oldGrid.values[6]?.[23]).toBe(723); // dow 7, hour 23
  });

  it('unequal halves collapse to their mean for an hour-keyed reader — not max, not first', async () => {
    const venue = await seedVenue();
    // What the hub produces once it re-buckets measured data: a busy half and a quiet one.
    await app!.inject({
      method: 'POST',
      url: '/api/internal/affluence',
      headers: auth,
      payload: {
        slots: [
          { location_id: venue, day_of_week: 1, slot: 26, estimated_impressions: 100 },
          { location_id: venue, day_of_week: 1, slot: 27, estimated_impressions: 200 },
        ],
      },
    });
    const grid = await loadBackupGrid(venue);
    expect(grid.values[0]?.[13]).toBe(150); // round((100 + 200) / 2)
    expect(grid.values[0]?.[13]).not.toBe(200); // max() would INFLATE — A_max ratchets, permanently
    expect(grid.values[0]?.[13]).not.toBe(100); // first() would TRUNCATE
  });
});

afterAll(async () => {
  await sql.end();
});
