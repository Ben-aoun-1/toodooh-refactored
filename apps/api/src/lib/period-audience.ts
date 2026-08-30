import { addDays, format, parseISO } from 'date-fns';

import type { MonthlyStatsDaily } from '../db/schema.js';

import { estimatedDayAudience, isMeasuredDay } from './monthly-audience.js';
import type { DateRange } from './report/derive.js';

/**
 * PERF-R1 / PERF-R2 (operator 2026-08-30 — supersede US-P.5 « measured-only ») — THE period
 * merge, api-side, reused by every surface (S01 KPIs, the /audience read, the PDF twin).
 *
 * RULE: for each day of the période → the PAX measure when one exists for that day, else the
 * venue's affluence grid stands in. `screenhost_affluence` IS the hub's per-cell PAX-first merge
 * (source 'measured' = the sensor, 'backup' = the manual grid), so day-level measure-wins over
 * the grid completes the ticket's cell rule at the granularity toodooh holds. Never a zero
 * because the sensor was silent; a venue with neither measure nor grid derives an HONEST zero.
 *
 * Seeded by TOODOOH-AFF1's provenance work: `monthly-audience.ts` owns what "measured" means
 * and what a grid day estimates; `affluence-provenance.ts` owns per-cell labeling. This module
 * only adds the période: bounds are inclusive, and the current day is the last claimable one —
 * a période reaching into the future never invents audience for days that have not happened.
 *
 * A day with NO information — no measure AND a zero grid stand-in — is NOT a data day: it drops
 * out instead of dragging the averages down as a fake zero (a MEASURED zero, however, is a
 * measurement and stays). Averages therefore divide by days WITH data, as everywhere else.
 */

export interface PeriodDay {
  date: string; // YYYY-MM-DD
  audience: number;
  source: 'measured' | 'estimated';
}

export interface PeriodAudience {
  days: PeriodDay[];
  total: number;
  measuredDays: number;
  estimatedDays: number;
  /** % of the période's days that are estimated (rounded); null when the période holds no day. */
  estimatedPct: number | null;
}

export interface PeriodAudienceInput {
  /** The venue's stored monthly-stats rows (any order; only rows overlapping the range matter). */
  months: { month: string; daily: MonthlyStatsDaily[] }[];
  /** The venue's 7×24 affluence grid, Monday-first (the hub's PAX-first merge). */
  grid: number[][];
  /** Inclusive ISO bounds. */
  range: DateRange;
  /** Tunis today — the last day the période may claim. */
  todayIso: string;
}

export function periodAudience(input: PeriodAudienceInput): PeriodAudience {
  const { months, grid, range, todayIso } = input;
  const byDate = new Map<string, MonthlyStatsDaily>();
  for (const month of months) {
    for (const entry of month.daily) byDate.set(entry.date, entry);
  }

  const last = range.to <= todayIso ? range.to : todayIso;
  const days: PeriodDay[] = [];
  if (range.from <= last) {
    for (
      let cursor = parseISO(range.from);
      !Number.isNaN(cursor.getTime()) && format(cursor, 'yyyy-MM-dd') <= last;
      cursor = addDays(cursor, 1)
    ) {
      const date = format(cursor, 'yyyy-MM-dd');
      const entry = byDate.get(date);
      if (isMeasuredDay(entry)) {
        days.push({ date, audience: entry.audience, source: 'measured' });
      } else {
        const estimate = estimatedDayAudience(grid, date);
        if (estimate > 0) days.push({ date, audience: estimate, source: 'estimated' });
      }
    }
  }

  const measuredDays = days.filter((d) => d.source === 'measured').length;
  const estimatedDays = days.length - measuredDays;
  return {
    days,
    total: days.reduce((sum, d) => sum + d.audience, 0),
    measuredDays,
    estimatedDays,
    estimatedPct: days.length === 0 ? null : Math.round((estimatedDays / days.length) * 100),
  };
}

/**
 * PERF-R2 — the ISO weekdays (1=Mon..7=Sun) the période actually contains: the S02 heatmap masks
 * the weekdays the owner did not ask about. Any période of 7+ days keeps the whole week.
 */
export function weekdaysInRange(range: DateRange): Set<number> {
  const weekdays = new Set<number>();
  if (range.from > range.to) return weekdays;
  for (
    let cursor = parseISO(range.from);
    !Number.isNaN(cursor.getTime()) &&
    format(cursor, 'yyyy-MM-dd') <= range.to &&
    weekdays.size < 7;
    cursor = addDays(cursor, 1)
  ) {
    weekdays.add(((cursor.getDay() + 6) % 7) + 1); // date-fns getDay: 0=Sun → ISO 1=Mon..7=Sun
  }
  return weekdays;
}
