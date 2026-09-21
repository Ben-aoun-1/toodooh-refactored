import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { db, sql } from '../src/db/client.js';
import { screenhostAffluence, screenhostAffluenceHourly, screenhosts } from '../src/db/schema.js';
import {
  firstOpenMeasuredDay,
  loadPeriodAudienceInput,
} from '../src/lib/period-audience-source.js';
import { periodAudience } from '../src/lib/period-audience.js';

import { bothHalves, resetAuthTables } from './helpers/db-test-setup.js';

// LEARN-1 T3 — the DB half: the loader reads `estimate`, the venue's CURRENT hours and the ONE
// switch, so every surface (/audience, /affluence?from&to, the PDF, the admin Tests page) runs the
// same merge. Real Postgres.

const HUB_DAY = '2026-09-14'; // a Monday

const seedVenue = async (open: number | null, close: number | null): Promise<string> => {
  const [sh] = await db
    .insert(screenhosts)
    .values({
      name: 'LEARN-1 venue',
      openingHour: open,
      closingHour: close,
      createdAt: new Date('2026-09-01T09:00:00Z'),
    })
    .returning({ id: screenhosts.id });
  return sh!.id;
};

/** One hub day: 1h night 99 (closed for 08 → 22), 9h measured 10, 10h estimated 30, 11h silent. */
const seedHubDay = async (venue: string): Promise<void> => {
  await db.insert(screenhostAffluenceHourly).values([
    { screenhostId: venue, date: HUB_DAY, hour: 1, slot: 2, value: 99 },
    { screenhostId: venue, date: HUB_DAY, hour: 9, slot: 18, value: 10 },
    { screenhostId: venue, date: HUB_DAY, hour: 9, slot: 19, value: 10 },
    { screenhostId: venue, date: HUB_DAY, hour: 10, slot: 20, value: null, estimate: 30 },
    { screenhostId: venue, date: HUB_DAY, hour: 10, slot: 21, value: null, estimate: 30 },
    { screenhostId: venue, date: HUB_DAY, hour: 11, slot: 22, value: null, deviceOnline: false },
  ]);
  // The typical week says 500 at Monday 12h — what today's merge falls back to.
  await db
    .insert(screenhostAffluence)
    .values(bothHalves({ screenhostId: venue, dayOfWeek: 1, hour: 12, estimatedImpressions: 500 }));
};

const load = (venue: string, learnedAffluence?: boolean) =>
  loadPeriodAudienceInput({
    venueId: venue,
    range: { from: HUB_DAY, to: HUB_DAY },
    todayIso: '2026-09-21',
    nowSlot: 48,
    learnedAffluence,
  });

afterAll(async () => {
  await sql.end();
});

describe('LEARN-1 T3 — loadPeriodAudienceInput wires the switch, the hours and the estimate', () => {
  beforeEach(async () => {
    await resetAuthTables();
  });

  it('flag ON: the venue hours ride along, the estimate is loaded, the hub day is 9h + 10h = 40', async () => {
    const venue = await seedVenue(8, 22);
    await seedHubDay(venue);
    const input = await load(venue, true);
    expect(input.learned).toEqual({ openingHour: 8, closingHour: 22 });
    expect(input.hourly).toContainEqual({
      date: HUB_DAY,
      slot: 20,
      value: null,
      estimate: 30,
      deviceOnline: null,
    });
    expect(periodAudience(input).days).toEqual([
      { date: HUB_DAY, audience: 40, source: 'estimated', hasMeasured: true },
    ]);
  });

  it('flag OFF: learned is null and the old merge runs — 1h 99 + 9h 10 + 12h grid 500 = 609', async () => {
    const venue = await seedVenue(8, 22);
    await seedHubDay(venue);
    const input = await load(venue, false);
    expect(input.learned).toBeNull();
    expect(periodAudience(input).total).toBe(609);
  });

  it('DEFAULT (no override) is the env switch — off in this suite, so the old merge', async () => {
    const venue = await seedVenue(8, 22);
    await seedHubDay(venue);
    const input = await load(venue);
    expect(input.learned).toBeNull();
    expect(periodAudience(input).total).toBe(609);
  });

  it('the CURRENT hours apply to all history: 10 → 22 drops the 9h reading retroactively', async () => {
    const venue = await seedVenue(8, 22);
    await seedHubDay(venue);
    await db
      .update(screenhosts)
      .set({ openingHour: 10, closingHour: 22 })
      .where(eq(screenhosts.id, venue));
    expect(periodAudience(await load(venue, true)).days).toEqual([
      { date: HUB_DAY, audience: 30, source: 'estimated', hasMeasured: false },
    ]);
  });

  it('a venue with NO hours is open all day: the night 99 counts — 99 + 10 + 30 = 139', async () => {
    const venue = await seedVenue(null, null);
    await seedHubDay(venue);
    const input = await load(venue, true);
    expect(input.learned).toEqual({ openingHour: null, closingHour: null });
    expect(periodAudience(input).total).toBe(139);
  });
});

// LEARN-1 T3 amendment (Task 9's review, Important 1) — under the flag the floor is the first
// OPEN measured day: a closed-hour reading stored before the flag must not drag it earlier.
describe('LEARN-1 T3 amendment — under the flag the floor is the first OPEN measured day', () => {
  beforeEach(async () => {
    await resetAuthTables();
  });

  const EARLY_CLOSED = '2026-09-07'; // 23:00 — closed for the venue's 10 → 22
  const FIRST_OPEN = '2026-09-08'; // 10:00 — open

  it('flag ON: the closed-hour reading does not set the floor — 2026-09-08; flag OFF: 2026-09-07', async () => {
    const venue = await seedVenue(10, 22);
    await db.insert(screenhostAffluenceHourly).values([
      { screenhostId: venue, date: EARLY_CLOSED, hour: 23, slot: 46, value: 5 },
      { screenhostId: venue, date: FIRST_OPEN, hour: 10, slot: 20, value: 8 },
    ]);
    expect((await load(venue, true)).onboardedIso).toBe(FIRST_OPEN);
    expect((await load(venue, false)).onboardedIso).toBe(EARLY_CLOSED);
  });

  it('NULL hours = open all day: the 23h reading counts — the floor is 2026-09-07', async () => {
    const venue = await seedVenue(null, null);
    await db.insert(screenhostAffluenceHourly).values([
      { screenhostId: venue, date: EARLY_CLOSED, hour: 23, slot: 46, value: 5 },
      { screenhostId: venue, date: FIRST_OPEN, hour: 10, slot: 20, value: 8 },
    ]);
    expect((await load(venue, true)).onboardedIso).toBe(EARLY_CLOSED);
  });

  it('firstOpenMeasuredDay: opening === closing is zero-width — null even with a measured row', async () => {
    const venue = await seedVenue(9, 9);
    await db
      .insert(screenhostAffluenceHourly)
      .values([{ screenhostId: venue, date: FIRST_OPEN, hour: 10, slot: 20, value: 8 }]);
    await expect(
      firstOpenMeasuredDay(venue, { openingHour: 9, closingHour: 9 }),
    ).resolves.toBeNull();
  });
});
