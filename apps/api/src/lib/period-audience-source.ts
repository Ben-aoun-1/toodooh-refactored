import { and, asc, eq, gte, isNotNull, lte } from 'drizzle-orm';

import { db } from '../db/client.js';
import {
  screenhostAffluence,
  screenhostAffluenceHourly,
  screenhostMonthlyStats,
  screenhosts,
} from '../db/schema.js';

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
}

export async function loadPeriodAudienceInput(
  params: PeriodSourceParams,
): Promise<PeriodAudienceInput> {
  const { venueId, range, todayIso } = params;

  const [months, hourlyRows, grid, onboardedIso] = await Promise.all([
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
    db
      .select({
        date: screenhostAffluenceHourly.date,
        slot: screenhostAffluenceHourly.slot,
        value: screenhostAffluenceHourly.value,
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
  ]);

  return {
    months,
    hourly: hourlyRows,
    grid,
    range,
    todayIso,
    nowSlot: params.nowSlot ?? tunisSlotOf(new Date()),
    onboardedIso,
    learned: null, // LEARN-1 — wired to the switch and the venue's hours in the next commit
  };
}
