import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { db, sql } from '../src/db/client.js';
import {
  type NewUser,
  eventAttestations,
  events,
  screenhostAffluence,
  screenhosts,
  users,
} from '../src/db/schema.js';
import { assemblePool } from '../src/lib/dispatch/pool.js';
import { SPS_NEUTRAL, recomputeVenueSps } from '../src/lib/sps-score.js';

import { bothHalves, resetAuthTables } from './helpers/db-test-setup.js';
import { seedInstalledScreen } from './helpers/installed-screen.js';

// SPS-DISPATCH1 (ruled 2026-09-01) — end to end, through the real pool: a venue whose score is not
// computable does not carry its defaults-90 into the ORDERING INPUT. It ranks at the neutral
// midpoint. Everything else about the score is deliberately untouched — the stored snapshot, the
// daily job, C_max, capacité and the owner-facing number all stay exactly where they were.

const FAKE_CAMPAIGN = '11111111-1111-4111-8111-111111111111';
const POOL_INPUTS = { s: 10, t: 1, fMaxSeconds: 300 };
const WINDOW = { id: FAKE_CAMPAIGN, startDate: '2026-09-07', endDate: '2026-09-13' };

let seq = 0;

/** A venue with affluence (so it survives capacity) and a STORED sps of `sps`. */
const seedVenue = async (sps: number, opts: { withHistory: boolean }): Promise<string> => {
  seq += 1;
  const values: NewUser = {
    email: `spsd1-${seq}@example.com`,
    contactName: `Owner ${seq}`,
    role: 'individual_owner',
    status: 'approved',
  };
  const [owner] = await db.insert(users).values(values).returning();
  const [sh] = await db
    .insert(screenhosts)
    .values({
      name: `SPSD1 venue ${seq}`,
      ownerId: owner?.id ?? '',
      sps: String(sps),
      openingHour: 8,
      closingHour: 18,
      broadcastCapacity: 4,
    })
    .returning();
  const id = sh?.id ?? '';

  const rows = [];
  for (let dow = 1; dow <= 7; dow += 1)
    for (let h = 8; h < 18; h += 1)
      rows.push({ screenhostId: id, dayOfWeek: dow, hour: h, estimatedImpressions: 500 });
  await db.insert(screenhostAffluence).values(bothHalves(rows));
  await seedInstalledScreen(id);

  if (opts.withHistory) {
    // ONE real observation — an inspection it passed. Dated far in the past so it cannot leak into
    // any upcoming-events surface; the 90 d respect window reads the ATTESTATION's own date.
    const [ev] = await db
      .insert(events)
      .values({
        name: `SPSD1 inspection ${seq}`,
        kickoffAt: new Date(Date.now() - 200 * 24 * 60 * 60 * 1000),
        endsAt: new Date(Date.now() - 200 * 24 * 60 * 60 * 1000 + 60 * 60 * 1000),
      })
      .returning();
    await db.insert(eventAttestations).values({
      eventId: ev?.id ?? '',
      screenhostId: id,
      authorId: owner?.id ?? '',
      respecte: true,
    });
  }
  return id;
};

const spsInPool = async (venueId: string): Promise<number | undefined> => {
  const { pool } = await assemblePool(db, WINDOW, POOL_INPUTS);
  return pool.find((entry) => entry.id === venueId)?.sps;
};

describe('SPS-DISPATCH1 — the ordering input (real Postgres)', () => {
  beforeEach(async () => {
    await resetAuthTables();
  });

  it('an UNSCORED venue enters the pool at the neutral midpoint, not at its stored 90', async () => {
    const venue = await seedVenue(90, { withHistory: false });
    expect(await spsInPool(venue)).toBe(SPS_NEUTRAL);
    expect(await spsInPool(venue)).not.toBe(90);
  });

  it('a venue with ONE real observation keeps its earned score — the pin is not vacuous', async () => {
    const venue = await seedVenue(90, { withHistory: true });
    expect(await spsInPool(venue)).toBe(90);
  });

  it('it lands BETWEEN an earned score above and an earned score below — not first, not last', async () => {
    const high = await seedVenue(80, { withHistory: true });
    const unscored = await seedVenue(90, { withHistory: false }); // stored 90 — the defaults score
    const low = await seedVenue(20, { withHistory: true });

    const { pool } = await assemblePool(db, WINDOW, POOL_INPUTS);
    const byId = new Map(pool.map((entry) => [entry.id, entry.sps]));
    expect(byId.get(high)).toBe(80);
    expect(byId.get(unscored)).toBe(SPS_NEUTRAL);
    expect(byId.get(low)).toBe(20);
    // The ruling in one line: its stored 90 would have beaten BOTH; neutral sits between them.
    expect(byId.get(high)!).toBeGreaterThan(byId.get(unscored)!);
    expect(byId.get(unscored)!).toBeGreaterThan(byId.get(low)!);
  });

  it('BOUNDARY: the STORED score is untouched — this lane changes a sort key, nothing else', async () => {
    const venue = await seedVenue(90, { withHistory: false });
    expect(await spsInPool(venue)).toBe(SPS_NEUTRAL);

    // The column still reads 90, and the recompute path still writes the real 90 into it. Hiding
    // a venue's rank must never quietly rewrite its record.
    const [before] = await db
      .select({ sps: screenhosts.sps })
      .from(screenhosts)
      .where(eq(screenhosts.id, venue));
    expect(Number(before?.sps)).toBe(90);

    expect(await recomputeVenueSps(venue)).toBe(90);
    const [after] = await db
      .select({ sps: screenhosts.sps })
      .from(screenhosts)
      .where(eq(screenhosts.id, venue));
    expect(Number(after?.sps)).toBe(90);
    // …and the ordering input is STILL neutral after the recompute wrote 90 back.
    expect(await spsInPool(venue)).toBe(SPS_NEUTRAL);
  });
});

afterAll(async () => {
  await sql.end();
});
