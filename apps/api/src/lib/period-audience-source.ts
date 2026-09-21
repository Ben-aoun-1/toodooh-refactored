import { and, asc, eq, gte, isNotNull, lte, sql } from 'drizzle-orm';

import { db } from '../db/client.js';
import {
  screenhostAffluence,
  screenhostAffluenceHourly,
  screenhostMonthlyStats,
  screenhosts,
} from '../db/schema.js';
import { env } from '../env.js';

import { tunisDateOf } from './campaign-dates.js';
import { SLOTS_PER_DAY, inEffectSql, tunisSlotOf } from './half-hour-slots.js';
import { emptyBackupGrid, type BackupGrid, type PeriodAudienceInput } from './period-audience.js';
import type { DateRange } from './report/derive.js';

/**
 * AUD-HOURLY1-C — the DB half of the période merge, in one place.
 *
 * Three surfaces need exactly the same four reads to say the same thing: `GET /:id/audience`
 * (S01), `GET /:id/affluence?from&to` (S02) and `assembleReportData` (the PDF twins). Duplicating
 * the queries is how they would drift apart, so they share this loader and `periodAudience` gets
 * one shape of input whoever asked.
 */

/** The venue's backup grid + which cells the admin actually FILLED (rules 2 and 3 turn on it). */
export const loadBackupGrid = async (venueId: string): Promise<BackupGrid> => {
  // Slice C — the grid is 7×48 now, so the rows are read SLOT-SHAPED and the MEJ-13-B collapse is
  // gone from this path. (It stays at dispatch/pool.ts, event-pricing and monthly-audience, which
  // are hour-keyed by design — see the notes there.)
  const rows = await db
    .select({
      dayOfWeek: screenhostAffluence.dayOfWeek,
      slot: screenhostAffluence.slot,
      estimatedImpressions: screenhostAffluence.estimatedImpressions,
    })
    .from(screenhostAffluence)
    // OFF-1 — a suspended manual cell never reaches the grid at all: `has` stays false for that
    // slot, so the merge's rule 3 cannot fall back to a value the hub has withdrawn.
    .where(
      and(eq(screenhostAffluence.screenhostId, venueId), inEffectSql(screenhostAffluence.inEffect)),
    );
  const grid = emptyBackupGrid();
  for (const row of rows) {
    const index = row.dayOfWeek - 1;
    if (index < 0 || index > 6 || row.slot < 0 || row.slot >= SLOTS_PER_DAY) continue;
    grid.values[index]![row.slot] = row.estimatedImpressions;
    grid.has[index]![row.slot] = true;
  }
  return grid;
};

/**
 * MEJ-7b (Mejri, ruled 2026-09-02) — THE ESTIMATION FLOOR: the first day the backup grid may
 * stand in for. ONE derivation, no parameter, so no caller can hold a different opinion.
 *
 * It used to be the venue's creation day, computed independently in THREE places — this loader,
 * `report/assemble.ts` and the `/audience` route. Her venue was created 26/08 and its sensor
 * attached 31/08, so « Votre progression depuis le début » showed 57 people for 26/08: the manual
 * grid answering for a Wednesday on which no sensor existed. « Il faut avoir 3 jours d'affluence
 * et non pas 4 jours. »
 *
 *     floor = max(creation day, earliest measured reading)
 *
 * A READING IS PROOF OF OBSERVATION — the same principle the hub uses for its own window. toodooh
 * does not know when the device was linked (that push is still a stub; MEJ-7 proper is a wire, and
 * it is banked), but it knows when the venue was first observed, and the grid may not pretend to
 * describe anything earlier.
 *
 * ⚠️ `value IS NOT NULL` is load-bearing, not defensive. Since OFF-1 the hub sends rows for EMPTY
 * slots (`value: null` carrying only `device_online`) — 8 386 of them on the first push. Such a row
 * is a RECORD OF SILENCE, not a reading; counting it would drag the floor back to the first slot
 * the hub reported on and restore this very bug in a new disguise.
 *
 * No measured row at all → the creation day, unchanged. A manual-only venue is « offline
 * everywhere », so its grid applies from creation — the same reading of the world as OFF-1.
 */
export const estimationFloor = async (venueId: string): Promise<string | null> => {
  const [[venue], firstReading] = await Promise.all([
    db
      .select({ createdAt: screenhosts.createdAt })
      .from(screenhosts)
      .where(eq(screenhosts.id, venueId))
      .limit(1),
    firstMeasuredDay(venueId),
  ]);
  if (!venue) return null;
  const createdIso = tunisDateOf(venue.createdAt);
  // ISO dates compare lexicographically, so `max` is a string comparison.
  return firstReading !== null && firstReading > createdIso ? firstReading : createdIso;
};

/**
 * The first Tunis day the sensor produced a READING for this venue (`value IS NOT NULL` — a
 * record of silence is not an observation, see `estimationFloor`), or null when it never has.
 * ONE query, shared by the floor and by the admin « Tests » page's « Première mesure du capteur »
 * (ADM-OBS2), so the two can never name different days.
 */
export const firstMeasuredDay = async (venueId: string): Promise<string | null> => {
  const [first] = await db
    .select({ date: screenhostAffluenceHourly.date })
    .from(screenhostAffluenceHourly)
    .where(
      and(
        eq(screenhostAffluenceHourly.screenhostId, venueId),
        isNotNull(screenhostAffluenceHourly.value),
      ),
    )
    .orderBy(asc(screenhostAffluenceHourly.date))
    .limit(1);
  return first?.date ?? null;
};

/**
 * LEARN-1 T3 amendment (Task 9's review, Important 1) — under the flag, the floor is the first
 * date holding a measured cell (`value IS NOT NULL`) in a slot OPEN for the venue's CURRENT hours
 * — `isOpenSlot` semantics, done in SQL: either bound NULL = all open, `opening === closing` =
 * nothing open, wrap-around included. A legacy per-date row can hold a closed-hour measured cell
 * (a sensor installed at 23:00 after a 22:00 close, stored before the flag); such a row must not
 * set the floor, or « Depuis le début » counts a full estimated day the hub itself shows blank.
 * Read only when `learned !== null` — flag off keeps `estimationFloor` byte for byte.
 */
export const firstOpenMeasuredDay = async (
  venueId: string,
  hours: { openingHour: number | null; closingHour: number | null },
): Promise<string | null> => {
  const { openingHour, closingHour } = hours;
  if (openingHour !== null && closingHour !== null && openingHour === closingHour) return null;
  const hour = sql`(${screenhostAffluenceHourly.slot} / 2)`;
  const openFilter =
    openingHour === null || closingHour === null
      ? sql`true`
      : openingHour < closingHour
        ? sql`${hour} >= ${openingHour} AND ${hour} < ${closingHour}`
        : sql`${hour} >= ${openingHour} OR ${hour} < ${closingHour}`;
  const [first] = await db
    .select({ date: screenhostAffluenceHourly.date })
    .from(screenhostAffluenceHourly)
    .where(
      and(
        eq(screenhostAffluenceHourly.screenhostId, venueId),
        isNotNull(screenhostAffluenceHourly.value),
        openFilter,
      ),
    )
    .orderBy(asc(screenhostAffluenceHourly.date))
    .limit(1);
  return first?.date ?? null;
};

/** LEARN-1 — the flag-on floor: max(creation day, first OPEN measured day), as `estimationFloor`. */
const learnedFloor = async (
  venueId: string,
  hours: { openingHour: number | null; closingHour: number | null },
  venue: { createdAt: Date } | undefined,
): Promise<string | null> => {
  const firstOpen = await firstOpenMeasuredDay(venueId, hours);
  if (!venue) return firstOpen;
  const createdIso = tunisDateOf(venue.createdAt);
  return firstOpen !== null && firstOpen > createdIso ? firstOpen : createdIso;
};

export interface PeriodSourceParams {
  venueId: string;
  range: DateRange;
  todayIso: string;
  /**
   * S02-FUT1 — the current Tunis half-hour slot. Defaults to the clock at call time, which is the
   * same instant every surface derives `todayIso` from. Pass it only to freeze the boundary (the
   * tests do); the three production surfaces all take the default, so they cannot disagree about
   * what « not yet » means.
   */
  nowSlot?: number;
  /**
   * LEARN-1 T3 — which merge to run. Defaults to env.LEARNED_AFFLUENCE_ENABLED, THE switch; every
   * production surface takes the default. Tests pass it to pin either side without the environment.
   */
  learnedAffluence?: boolean;
}

export async function loadPeriodAudienceInput(
  params: PeriodSourceParams,
): Promise<PeriodAudienceInput> {
  const { venueId, range, todayIso } = params;
  const learnedAffluence = params.learnedAffluence ?? env.LEARNED_AFFLUENCE_ENABLED;

  const [months, hourlyRows, grid, defaultFloor, venueRows] = await Promise.all([
    // Month rows overlapping the range — the day-granularity history older than the hourly window.
    db
      .select({ month: screenhostMonthlyStats.month, daily: screenhostMonthlyStats.daily })
      .from(screenhostMonthlyStats)
      .where(
        and(
          eq(screenhostMonthlyStats.screenhostId, venueId),
          gte(screenhostMonthlyStats.month, range.from.slice(0, 7)),
          lte(screenhostMonthlyStats.month, range.to.slice(0, 7)),
        ),
      ),
    // The MEASURED hourly cells. The (screenhost_id, date, hour) unique index serves this range
    // read on its leading prefix — the reason slice A shipped one index rather than two.
    // Slice C — periodAudience keys its cells on (date, SLOT); no collapse on this path.
    // LEARN-1 — `estimate` rides along; periodAudience reads it only under the flag.
    db
      .select({
        date: screenhostAffluenceHourly.date,
        slot: screenhostAffluenceHourly.slot,
        value: screenhostAffluenceHourly.value,
        estimate: screenhostAffluenceHourly.estimate,
        deviceOnline: screenhostAffluenceHourly.deviceOnline,
      })
      .from(screenhostAffluenceHourly)
      .where(
        and(
          eq(screenhostAffluenceHourly.screenhostId, venueId),
          gte(screenhostAffluenceHourly.date, range.from),
          lte(screenhostAffluenceHourly.date, range.to),
        ),
      ),
    loadBackupGrid(venueId),
    estimationFloor(venueId),
    // LEARN-1 T3 — the venue's CURRENT hours: under the flag every slot outside them is ignored,
    // across the whole history (spec §3, « the venue's current hours apply to all of its history »).
    db
      .select({
        openingHour: screenhosts.openingHour,
        closingHour: screenhosts.closingHour,
        createdAt: screenhosts.createdAt,
      })
      .from(screenhosts)
      .where(eq(screenhosts.id, venueId))
      .limit(1),
  ]);
  const venue = venueRows[0];
  const learned = learnedAffluence
    ? { openingHour: venue?.openingHour ?? null, closingHour: venue?.closingHour ?? null }
    : null;
  // LEARN-1 T3 amendment — under the flag the floor is max(creation day, first OPEN measured day):
  // estimationFloor's shape, but a closed-hour reading stored before the flag cannot drag it earlier.
  // Never measured inside the hours → the creation day (rule 6: typed from creation), never null.
  const onboardedIso =
    learned !== null ? await learnedFloor(venueId, learned, venue) : defaultFloor;

  return {
    months,
    hourly: hourlyRows,
    grid,
    range,
    todayIso,
    nowSlot: params.nowSlot ?? tunisSlotOf(new Date()),
    onboardedIso,
    learned,
  };
}
