import { addDays, format, getDay, parseISO } from 'date-fns';

import type { MonthlyStatsDaily } from '../db/schema.js';

import { isMeasuredDay } from './monthly-audience.js';
import type { DateRange } from './report/derive.js';

/**
 * THE période merge, api-side, reused by every surface (S01 KPIs, the /audience read, the S02
 * grid and the PDF twins). One home, so the page and the document cannot disagree.
 *
 * ── AUD-HOURLY1-C (amendment 2026-08-31) — THE MERGE IS PER (date, hour), NOT PER DAY ──────────
 *
 * WHY: Mejri unplugged the sensor, waited, and « rien ne s'est passé ». Because the merge ran at
 * DAY level, a day carrying ANY reading was "measured" wholesale, so the hour the sensor was dark
 * could never fall back to the admin's grid. The hub has always done this per cell; toodooh now
 * matches it. Per (date, hour) of the période — the 2026-08-26 ruling (« PAX first, the manual
 * grid as BACKUP where the measure is 0 during opening hours »):
 *
 *   1. measured cell present, value > 0            → MEASURED
 *   2. measured cell present, value == 0           → the backup grid cell for that (dow, hour) if
 *                                                    one EXISTS → BACKUP; if the grid has no such
 *                                                    cell the measured zero STANDS (no grid cell
 *                                                    means outside opening hours, by the hub's own
 *                                                    definition — « opening hours » = the cells the
 *                                                    admin filled)
 *   3. no measured cell                            → the backup grid cell if one exists → BACKUP;
 *                                                    else not a data point at all (the silent rule:
 *                                                    it must not drag averages down)
 *   4. the MEJ-2 onboarding floor bounds BACKUP ONLY — a real measurement before the floor is a
 *      fact about the venue and always counts.
 *
 * ── DAY PRECEDENCE (the subtle part) ───────────────────────────────────────────────────────────
 * `screenhost_affluence_hourly` only carries the hub's rolling 35-day window, so for one date:
 *   • ANY hourly cell for that date → the day is built FROM HOURS (rule above) and monthly_stats
 *     is NEVER added on top — that would double count the same audience;
 *   • else a MEASURED monthly_stats daily total → the day is measured at DAY granularity, with no
 *     hour detail (this is history older than the window, and it contributes no S02 cell);
 *   • else the backup grid, bounded by the floor.
 *
 * ── VOCABULARY ─────────────────────────────────────────────────────────────────────────────────
 * A DAY's source is 'measured' | 'estimated' (the /audience wire the web already reads); a CELL's
 * is 'measured' | 'backup' (the AffluenceSource vocabulary S02 already renders). They are the same
 * distinction under each consumer's own name.
 *
 * A day built from hours counts as MEASURED only when EVERY one of its cells is — one backup hour
 * makes the day's total an estimation. That is not a new rule: it is `dayProvenance`'s ruling from
 * AFF1 (the « Votre audience » day tiles), reused so the two surfaces keep saying the same thing,
 * and it is the conservative side — a day whose total contains an estimate never claims to be a
 * measurement, and therefore never becomes the « Pic d'audience » (MEJ-R1).
 */

/** One MEASURED hourly cell as `screenhost_affluence_hourly` holds it (Tunis clock, verbatim). */
export interface HourlyCell {
  date: string; // YYYY-MM-DD
  hour: number; // 0–23
  value: number;
}

/**
 * The venue's backup grid. `values` is the familiar 7×24 Monday-first grid; `has` says whether the
 * admin actually FILLED that cell — the distinction rules 2 and 3 turn on, and one a zero-filled
 * grid alone cannot express (a missing cell and a real 0 would be identical).
 */
export interface BackupGrid {
  values: number[][];
  has: boolean[][];
}

export interface PeriodCell {
  date: string; // YYYY-MM-DD
  hour: number; // 0–23
  value: number;
  source: 'measured' | 'backup';
}

export interface PeriodDay {
  date: string; // YYYY-MM-DD
  audience: number;
  source: 'measured' | 'estimated';
  /**
   * MEJ-R2 — does this day hold AT LEAST ONE measured cell? `source` answers a different, stricter
   * question ("is EVERY cell measured", AFF1's dayProvenance) and both are needed: `source` drives
   * the provenance a reader sees, `hasMeasured` drives peak eligibility. A day built entirely from
   * the grid has neither.
   */
  hasMeasured: boolean;
}

export interface PeriodAudience {
  days: PeriodDay[];
  /** The hour-granularity cells of the période — S02's source, and the caption's denominator. */
  cells: PeriodCell[];
  total: number;
  measuredDays: number;
  estimatedDays: number;
  /**
   * « dont N % estimés ». AUD-HOURLY1-C moved the denominator from DAYS to DATA POINTS: every
   * merged cell counts once, and a day held only at day granularity (measured history older than
   * the hourly window) counts once as measured. Cells alone would read « 100 % estimation » on a
   * période whose measured half is old history with no cells — which would be a lie to a reader
   * who checks this caption closely. null when the période holds no data point at all.
   */
  estimatedPct: number | null;
}

export interface PeriodAudienceInput {
  /** Stored monthly-stats rows (any order; only rows overlapping the range matter). */
  months: { month: string; daily: MonthlyStatsDaily[] }[];
  /** MEASURED hourly cells overlapping the range (the hub's rolling window). */
  hourly: HourlyCell[];
  /** The venue's backup grid + which cells the admin filled. */
  grid: BackupGrid;
  /** Inclusive ISO bounds. */
  range: DateRange;
  /** Tunis today — the last day the période may claim. */
  todayIso: string;
  /**
   * MEJ-R1 — the venue's onboarding day (Tunis calendar day of `screenhosts.created_at`): the
   * FIRST day the BACKUP grid may stand in for. `null` = no known floor, nothing is clamped.
   * Required (not optional) so every call site states its floor rather than inheriting the
   * unbounded behaviour by omission.
   */
  onboardedIso: string | null;
}

/** A zero-filled 7×24 Monday-first grid with nothing marked as filled. */
export const emptyBackupGrid = (): BackupGrid => ({
  values: Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0)),
  has: Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => false)),
});

/** date-fns getDay: 0 = Sunday → the grid's Monday-first row index. */
const rowOf = (dateIso: string): number => (getDay(parseISO(dateIso)) + 6) % 7;

export function periodAudience(input: PeriodAudienceInput): PeriodAudience {
  const { months, hourly, grid, range, todayIso, onboardedIso } = input;

  const measuredDayByDate = new Map<string, MonthlyStatsDaily>();
  for (const month of months) {
    for (const entry of month.daily) measuredDayByDate.set(entry.date, entry);
  }
  // date → (hour → measured value). A date PRESENT here takes the hour path, even if every one of
  // its cells is a zero: the hub sends measured zeros deliberately, so "the sensor said nothing"
  // and "the sensor counted nobody" stay distinguishable right up to this merge.
  const hourlyByDate = new Map<string, Map<number, number>>();
  for (const cell of hourly) {
    const forDate = hourlyByDate.get(cell.date) ?? new Map<number, number>();
    forDate.set(cell.hour, cell.value);
    hourlyByDate.set(cell.date, forDate);
  }

  const days: PeriodDay[] = [];
  const cells: PeriodCell[] = [];
  /** Days held at DAY granularity only (measured history) — one measured data point each. */
  let dayGranularityMeasured = 0;

  const last = range.to <= todayIso ? range.to : todayIso;
  if (range.from <= last) {
    for (
      let cursor = parseISO(range.from);
      !Number.isNaN(cursor.getTime()) && format(cursor, 'yyyy-MM-dd') <= last;
      cursor = addDays(cursor, 1)
    ) {
      const date = format(cursor, 'yyyy-MM-dd');
      // Rule 4 — the floor bounds BACKUP only; measurement is never clamped.
      const mayBackup = onboardedIso === null || date >= onboardedIso;
      const row = rowOf(date);
      const measuredHours = hourlyByDate.get(date);

      if (measuredHours !== undefined) {
        // ── the hour path: monthly_stats is NEVER added on top (double counting) ──
        const dayCells: PeriodCell[] = [];
        for (let hour = 0; hour < 24; hour += 1) {
          const measured = measuredHours.get(hour);
          const gridHas = grid.has[row]?.[hour] === true && mayBackup;
          const gridValue = grid.values[row]?.[hour] ?? 0;
          if (measured !== undefined && measured > 0) {
            dayCells.push({ date, hour, value: measured, source: 'measured' }); // rule 1
          } else if (measured !== undefined) {
            // rule 2 — a measured ZERO defers to the grid where the admin declared the venue open
            if (gridHas) dayCells.push({ date, hour, value: gridValue, source: 'backup' });
            else dayCells.push({ date, hour, value: 0, source: 'measured' });
          } else if (gridHas) {
            dayCells.push({ date, hour, value: gridValue, source: 'backup' }); // rule 3
          }
          // else: no measure, no grid cell → not a data point at all (the silent rule)
        }
        if (dayCells.length > 0) {
          cells.push(...dayCells);
          days.push({
            date,
            audience: dayCells.reduce((sum, c) => sum + c.value, 0),
            // AFF1's dayProvenance ruling: one backup hour makes the whole day an estimation.
            source: dayCells.every((c) => c.source === 'measured') ? 'measured' : 'estimated',
            // MEJ-R2 — but ONE measured cell is enough to make the day peak-eligible.
            hasMeasured: dayCells.some((c) => c.source === 'measured'),
          });
        }
        continue;
      }

      const entry = measuredDayByDate.get(date);
      if (isMeasuredDay(entry)) {
        // ── day granularity: history older than the hourly window. No hour detail, no S02 cell.
        days.push({ date, audience: entry.audience, source: 'measured', hasMeasured: true });
        dayGranularityMeasured += 1;
        continue;
      }

      if (!mayBackup) continue;
      // ── the backup grid alone, cell by cell so S02 still sees this date ──
      const dayCells: PeriodCell[] = [];
      for (let hour = 0; hour < 24; hour += 1) {
        if (grid.has[row]?.[hour] === true) {
          dayCells.push({ date, hour, value: grid.values[row]?.[hour] ?? 0, source: 'backup' });
        }
      }
      if (dayCells.length > 0) {
        cells.push(...dayCells);
        days.push({
          date,
          audience: dayCells.reduce((sum, c) => sum + c.value, 0),
          source: 'estimated',
          hasMeasured: false, // grid only — MEJ-R1's real target: never the peak
        });
      }
    }
  }

  const measuredDays = days.filter((d) => d.source === 'measured').length;
  const estimatedCells = cells.filter((c) => c.source === 'backup').length;
  const dataPoints = cells.length + dayGranularityMeasured;
  return {
    days,
    cells,
    total: days.reduce((sum, d) => sum + d.audience, 0),
    measuredDays,
    estimatedDays: days.length - measuredDays,
    estimatedPct: dataPoints === 0 ? null : Math.round((estimatedCells / dataPoints) * 100),
  };
}

/** One aggregated S02 slot: `null` value = the période holds no cell for that (weekday, hour). */
export interface WeekCell {
  value: number | null;
  source: 'measured' | 'backup' | null;
}

/**
 * AUD-HOURLY1-C — S02 becomes GENUINELY période-scoped: the période's own (date, hour) cells
 * aggregated into weekday × hour, instead of rendering the hub's rolling typical week and merely
 * masking the weekdays the période misses (PERF-R2's approach, now superseded).
 *
 * A slot's value is the MEAN of the cells that fall on it (rounded — the wire has always carried
 * integers), and its provenance follows the same AFF1 ruling as everywhere else: measured only
 * when every contributing cell is measured; one backup cell makes the slot an estimation.
 */
export function weekGridFromCells(cells: PeriodCell[]): WeekCell[][] {
  // Flat 7×24 accumulators — indexed arithmetic, no nested optional chains to appease.
  const sums = new Array<number>(7 * 24).fill(0);
  const counts = new Array<number>(7 * 24).fill(0);
  const allMeasured = new Array<boolean>(7 * 24).fill(true);
  for (const cell of cells) {
    if (cell.hour < 0 || cell.hour > 23) continue;
    const at = rowOf(cell.date) * 24 + cell.hour;
    sums[at] = (sums[at] ?? 0) + cell.value;
    counts[at] = (counts[at] ?? 0) + 1;
    if (cell.source !== 'measured') allMeasured[at] = false;
  }
  return Array.from({ length: 7 }, (_, row) =>
    Array.from({ length: 24 }, (__, hour) => {
      const at = row * 24 + hour;
      const n = counts[at] ?? 0;
      if (n === 0) return { value: null, source: null };
      return {
        value: Math.round((sums[at] ?? 0) / n),
        source: allMeasured[at] === true ? ('measured' as const) : ('backup' as const),
      };
    }),
  );
}
