import { and, eq, gte, lte } from 'drizzle-orm';

import { db } from '../db/client.js';
import {
  screenhostAffluence,
  screenhostAffluenceHourly,
  screenhostMonthlyStats,
  screenhosts,
} from '../db/schema.js';

import { tunisDateOf } from './campaign-dates.js';
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
  const rows = await db
    .select({
      dayOfWeek: screenhostAffluence.dayOfWeek,
      hour: screenhostAffluence.hour,
      estimatedImpressions: screenhostAffluence.estimatedImpressions,
    })
    .from(screenhostAffluence)
    .where(eq(screenhostAffluence.screenhostId, venueId));
  const grid = emptyBackupGrid();
  for (const row of rows) {
    const index = row.dayOfWeek - 1;
    if (index < 0 || index > 6 || row.hour < 0 || row.hour > 23) continue;
    grid.values[index]![row.hour] = row.estimatedImpressions;
    grid.has[index]![row.hour] = true;
  }
  return grid;
};

export interface PeriodSourceParams {
  venueId: string;
  range: DateRange;
  todayIso: string;
  /**
   * MEJ-R1's floor. Pass it when the caller already holds the venue row (assembleReportData does)
   * to save a query; omit it and the loader reads `screenhosts.created_at` itself.
   */
  onboardedIso?: string | null;
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
    db
      .select({
        date: screenhostAffluenceHourly.date,
        hour: screenhostAffluenceHourly.hour,
        value: screenhostAffluenceHourly.value,
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
    params.onboardedIso !== undefined
      ? Promise.resolve(params.onboardedIso)
      : db
          .select({ createdAt: screenhosts.createdAt })
          .from(screenhosts)
          .where(eq(screenhosts.id, venueId))
          .limit(1)
          .then((rows) => (rows[0] ? tunisDateOf(rows[0].createdAt) : null)),
  ]);

  return { months, hourly: hourlyRows, grid, range, todayIso, onboardedIso };
}
