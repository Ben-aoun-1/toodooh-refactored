import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { db, sql } from '../src/db/client.js';
import {
  screenhostAffluence,
  screenhostAffluenceHourly,
  screenhostAmax,
  screenhosts,
} from '../src/db/schema.js';
import {
  AMAX_FALLBACK_PPH,
  computeAmax,
  measuredAmaxPph,
} from '../src/lib/event-pricing/pricing.js';

import { bothHalves, resetAuthTables } from './helpers/db-test-setup.js';

// LEARN-1 F1 (spec §9, operator-approved) — « le plus haut niveau de fréquentation (personnes/heure)
// jamais MESURÉ pour ce lieu … repli 50 ». Under LEARNED_AFFLUENCE_ENABLED the A_max candidate is
// the busiest HOUR ever measured inside the venue's opening hours: an hour is the mean of the
// measured half-hours it has (a lone half IS the hour), rounded like collapseHalvesToHour. Estimates,
// typed values and the typical week never count. The screenhost_amax ratchet stays. Flag off = today.

const ON = { learnedAffluence: true };
const OFF = { learnedAffluence: false };

let seq = 0;
const seedVenue = async (open: number | null = 8, close: number | null = 22): Promise<string> => {
  seq += 1;
  const [sh] = await db
    .insert(screenhosts)
    .values({ name: `F1 venue ${seq}`, openingHour: open, closingHour: close })
    .returning({ id: screenhosts.id });
  return sh!.id;
};

/** A typed / typical-week cell — Monday, both halves. */
const seedTyped = async (venue: string, hour: number, value: number): Promise<void> => {
  await db
    .insert(screenhostAffluence)
    .values(bothHalves({ screenhostId: venue, dayOfWeek: 1, hour, estimatedImpressions: value }));
};

const seedReading = async (
  venue: string,
  date: string,
  slot: number,
  value: number | null,
  estimate?: number,
): Promise<void> => {
  await db.insert(screenhostAffluenceHourly).values({
    screenhostId: venue,
    date,
    hour: Math.floor(slot / 2),
    slot,
    value,
    ...(estimate === undefined ? {} : { estimate }),
  });
};

const storedAmax = async (venue: string): Promise<number | null> => {
  const [row] = await db
    .select({ v: screenhostAmax.amaxPph })
    .from(screenhostAmax)
    .where(eq(screenhostAmax.screenhostId, venue));
  return row?.v ?? null;
};

afterAll(async () => {
  await sql.end();
});

describe('LEARN-1 F1 — computeAmax under the flag (real Postgres)', () => {
  beforeEach(async () => {
    await resetAuthTables();
  });

  it('the MEASURED peak beats a higher typed / typical-week value, and is persisted', async () => {
    const venue = await seedVenue();
    await seedTyped(venue, 9, 300); // the typed 300 the old A_max priced on
    await seedReading(venue, '2026-09-14', 18, 80);
    await seedReading(venue, '2026-09-14', 19, 100); // 9h = 90
    await seedReading(venue, '2026-09-07', 18, 60); // an older, quieter Monday
    expect(await computeAmax(venue, ON)).toBe(90);
    expect(await storedAmax(venue)).toBe(90);
  });

  it('an ESTIMATE never counts — only `value` is a measurement', async () => {
    const venue = await seedVenue();
    await seedReading(venue, '2026-09-14', 18, 40);
    await seedReading(venue, '2026-09-14', 20, null, 500);
    expect(await measuredAmaxPph(venue)).toBe(40);
  });

  it('a reading OUTSIDE opening hours is ignored (08 → 22: 23h is closed)', async () => {
    const venue = await seedVenue(8, 22);
    await seedReading(venue, '2026-09-14', 46, 400); // 23h00
    await seedReading(venue, '2026-09-14', 47, 400); // 23h30
    await seedReading(venue, '2026-09-14', 18, 60);
    expect(await computeAmax(venue, ON)).toBe(60);
  });

  it('halves are AVERAGED and rounded half-up (40 + 61 → 51, not 61); a lone half is its hour', async () => {
    const venue = await seedVenue();
    await seedReading(venue, '2026-09-14', 18, 40);
    await seedReading(venue, '2026-09-14', 19, 61); // 9h = round(50.5) = 51
    await seedReading(venue, '2026-09-14', 20, 45); // 10h, lone half = 45
    await seedReading(venue, '2026-09-15', 18, 50);
    await seedReading(venue, '2026-09-15', 19, null, 90); // silent half: 9h = the lone 50
    expect(await measuredAmaxPph(venue)).toBe(51);
  });

  it('nothing measured → the 50 fallback, UNPERSISTED (the typed 300 does not count)', async () => {
    const venue = await seedVenue();
    await seedTyped(venue, 9, 300);
    await seedReading(venue, '2026-09-14', 20, null, 500); // an estimate only
    expect(await computeAmax(venue, ON)).toBe(AMAX_FALLBACK_PPH);
    expect(await storedAmax(venue)).toBeNull();
  });

  it('the ratchet stays: a later shrink never writes the stored value down', async () => {
    const venue = await seedVenue();
    await seedReading(venue, '2026-09-14', 18, 90);
    expect(await computeAmax(venue, ON)).toBe(90);
    await db
      .delete(screenhostAffluenceHourly)
      .where(eq(screenhostAffluenceHourly.screenhostId, venue));
    expect(await computeAmax(venue, ON)).toBe(90);
    expect(await storedAmax(venue)).toBe(90);
  });

  it('a venue with NO hours is open all day: a 03h reading counts', async () => {
    const venue = await seedVenue(null, null);
    await seedReading(venue, '2026-09-14', 6, 70); // 03h00
    expect(await measuredAmaxPph(venue)).toBe(70);
  });

  it('flag OFF is today: the typical-week grid max, measured readings ignored', async () => {
    const venue = await seedVenue();
    await seedTyped(venue, 9, 120);
    await seedReading(venue, '2026-09-14', 18, 500);
    expect(await computeAmax(venue, OFF)).toBe(120);
    expect(await storedAmax(venue)).toBe(120);
  });

  // Controller addition (ruling P5) — the brief's suite has no wrap-around venue. A raw SQL `OR`
  // placed inside drizzle's `and(...)` is not parenthesised and can escape the other conditions
  // (Task 10's bug on this branch); this pins a wrap-around window against a post-midnight
  // measured hour, a closed hour with a HIGHER value that must be ignored, and another venue's
  // row that must not leak in.
  it('wrap-around hours (08 → 01): a post-midnight measured hour counts, closed hours do not, and another venue never leaks in', async () => {
    const venue = await seedVenue(8, 1); // open 08h..23h and 00h; closed 01h..07h
    const other = await seedVenue(8, 22);
    await seedReading(venue, '2026-09-14', 0, 75); // 00h00 — open, post-midnight
    await seedReading(venue, '2026-09-14', 6, 999); // 03h00 — closed, must be ignored
    await seedReading(other, '2026-09-14', 0, 500); // another venue's row — must not leak in
    expect(await measuredAmaxPph(venue)).toBe(75);
    expect(await computeAmax(venue, ON)).toBe(75);
  });

  // LEARN-1 F1 fix round (task-11 brief, step F1) — zero-width hours, an unknown venue, and the
  // ratchet under the flag: none of these change pricing.ts, they pin the existing behaviour.

  it('a zero-width window (opening === closing): measuredAmaxPph is 0 despite measured rows, and computeAmax falls back to the stored value, or 50 UNPERSISTED when there is none', async () => {
    const noStored = await seedVenue(9, 9);
    await seedReading(noStored, '2026-09-14', 18, 60); // 9h — inside the degenerate window, ignored
    expect(await measuredAmaxPph(noStored)).toBe(0);
    expect(await computeAmax(noStored, ON)).toBe(AMAX_FALLBACK_PPH);
    expect(await storedAmax(noStored)).toBeNull();

    const withStored = await seedVenue(9, 9);
    await db.insert(screenhostAmax).values({ screenhostId: withStored, amaxPph: 77 });
    await seedReading(withStored, '2026-09-14', 18, 60);
    expect(await measuredAmaxPph(withStored)).toBe(0);
    expect(await computeAmax(withStored, ON)).toBe(77);
    expect(await storedAmax(withStored)).toBe(77);
  });

  it('an unknown venue id (a random UUID): measuredAmaxPph is 0, computeAmax falls back to 50, and no screenhost_amax row is written', async () => {
    const unknown = randomUUID();
    expect(await measuredAmaxPph(unknown)).toBe(0);
    expect(await computeAmax(unknown, ON)).toBe(AMAX_FALLBACK_PPH);
    expect(await storedAmax(unknown)).toBeNull();
  });

  it('a stored grid-era A_max of 120 never gets lowered by a smaller measured peak under the flag', async () => {
    const venue = await seedVenue();
    await db.insert(screenhostAmax).values({ screenhostId: venue, amaxPph: 120 });
    await seedReading(venue, '2026-09-14', 18, 60); // 9h = 60
    expect(await computeAmax(venue, ON)).toBe(120);
    expect(await storedAmax(venue)).toBe(120);
  });

  it('flipping the flag on ratchets a stored 40 UP to a higher measured peak of 60', async () => {
    const venue = await seedVenue();
    await db.insert(screenhostAmax).values({ screenhostId: venue, amaxPph: 40 });
    await seedReading(venue, '2026-09-14', 18, 60); // 9h = 60
    expect(await computeAmax(venue, ON)).toBe(60);
    expect(await storedAmax(venue)).toBe(60);
  });
});
