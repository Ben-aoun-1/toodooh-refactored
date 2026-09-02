import { addDays, format, getDay, parseISO } from 'date-fns';

import type { MonthlyStatsDaily } from '../db/schema.js';

import { SLOTS_PER_DAY, SLOT_HOURS } from './half-hour-slots.js';
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

/** One half-hour cell as `screenhost_affluence_hourly` holds it (Tunis, verbatim). */
export interface HourlyCell {
  date: string; // YYYY-MM-DD
  slot: number; // 0–47 — slot = hour × 2 + half, half 0 = :00–:29
  /**
   * OFF-1 — `null` = the sensor reported NOTHING for this slot, which is a different fact from a
   * measured 0 (« it counted nobody »). The distinction is the one MEJ-1 and AFF1 exist to keep.
   */
  value: number | null;
  /** OFF-1 — was the device up during this slot, per the hub? `null`/absent = unknown. */
  deviceOnline?: boolean | null;
}

/**
 * The venue's backup grid. `values` is the familiar 7×24 Monday-first grid; `has` says whether the
 * admin actually FILLED that cell — the distinction rules 2 and 3 turn on, and one a zero-filled
 * grid alone cannot express (a missing cell and a real 0 would be identical).
 */
export interface BackupGrid {
  /** 7×48, Monday-first rows, columns indexed by SLOT (0–47). */
  values: number[][];
  has: boolean[][];
}

export interface PeriodCell {
  date: string; // YYYY-MM-DD
  slot: number; // 0–47
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
   * « dont N % estimés » — VALUE-WEIGHTED since slice C (ruled 2026-09-01):
   *
   *     Σ (estimated audience) / Σ (all audience)
   *
   * It used to be a share of DATA POINTS, and that made it granularity-dependent in a way no
   * reader could guess: a day of measured history older than the hourly window is ONE point, while
   * a day of half-hour cells is 48. On the realistic shape — 27 measured history days plus one
   * half-estimated day of slots — the point share says ≈ 32 % estimés when under 2 % of the PEOPLE
   * are estimated. Nobody reads « dont 32 % estimés » as « 32 % of rows »; they read people. An
   * overstatement of uncertainty is a lie in the same way an understatement is.
   *
   * Weighting by value says what the words say, and it is granularity-independent for free: a day
   * is a day whether it arrives as one point or forty-eight, and the slot duration cancels out of
   * the ratio. THIS IS A DEFINITION CHANGE and is the one quantity exempt from slice C's
   * equal-halves bit-identical pin (ruled).
   *
   * `null` still means EXACTLY what it meant: the période holds no data point at all. A période
   * that holds data whose total audience is 0 falls back to the point share rather than to null,
   * so `null` keeps its one meaning for the surfaces that branch on it.
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
   * S02-FUT1 — the CURRENT half-hour slot on the Tunis clock (0–47), from the SAME instant as
   * `todayIso`. The boundary between a slot that has elapsed and one that has not.
   *
   * Required, not optional, for the reason MEJ-R1's floor is: a caller that omits it would get the
   * old behaviour silently, and the old behaviour is the defect.
   */
  nowSlot: number;
  /**
   * MEJ-R1 — the venue's onboarding day (Tunis calendar day of `screenhosts.created_at`): the
   * FIRST day the BACKUP grid may stand in for. `null` = no known floor, nothing is clamped.
   * Required (not optional) so every call site states its floor rather than inheriting the
   * unbounded behaviour by omission.
   */
  onboardedIso: string | null;
}

/** A zero-filled 7×48 Monday-first grid with nothing marked as filled. */
export const emptyBackupGrid = (): BackupGrid => ({
  values: Array.from({ length: 7 }, () => Array.from({ length: SLOTS_PER_DAY }, () => 0)),
  has: Array.from({ length: 7 }, () => Array.from({ length: SLOTS_PER_DAY }, () => false)),
});

/**
 * Slice C — a day's audience from its cells: the level integrated over the day, NOT the sum of the
 * cells. Rounded to a whole number of people, which is a no-op whenever the two halves of every
 * hour agree (their `Σ (v × 0.5)` is exactly the old integer) and an honest integer when they do
 * not. Rounding at the DAY, not at the slot, so a half-person never accumulates across 48 cells.
 */
const dayAudience = (dayCells: readonly PeriodCell[]): number =>
  Math.round(dayCells.reduce((sum, c) => sum + c.value * SLOT_HOURS, 0));

/** date-fns getDay: 0 = Sunday → the grid's Monday-first row index. */
const rowOf = (dateIso: string): number => (getDay(parseISO(dateIso)) + 6) % 7;

export function periodAudience(input: PeriodAudienceInput): PeriodAudience {
  const { months, hourly, grid, range, todayIso, nowSlot, onboardedIso } = input;

  const measuredDayByDate = new Map<string, MonthlyStatsDaily>();
  for (const month of months) {
    for (const entry of month.daily) measuredDayByDate.set(entry.date, entry);
  }
  // date → (hour → measured value). A date PRESENT here takes the hour path, even if every one of
  // its cells is a zero: the hub sends measured zeros deliberately, so "the sensor said nothing"
  // and "the sensor counted nobody" stay distinguishable right up to this merge.
  const hourlyByDate = new Map<string, Map<number, HourlyCell>>();
  for (const cell of hourly) {
    const forDate = hourlyByDate.get(cell.date) ?? new Map<number, HourlyCell>();
    forDate.set(cell.slot, cell);
    hourlyByDate.set(cell.date, forDate);
  }

  const days: PeriodDay[] = [];
  const cells: PeriodCell[] = [];
  /** Days held at DAY granularity only (measured history) — one measured data point each. */
  let dayGranularityMeasured = 0;
  /** …and their audience, which is MEASURED and so weights the value-share's denominator only. */
  let dayGranularityAudience = 0;

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
      // S02-FUT1 (Mejri, ruled 2026-09-02) — RULE 5. A slot is « offline » only once it has
      // ELAPSED without a reading. Mejri typed 50 and 56 into the hub grid for 13h00 and 13h30,
      // looked at Peak Hours at 12h50 with the sensor ONLINE, and saw them already counted: the
      // grid was standing in for a failure that had not happened. « Les données forcées ne
      // devraient être prises en compte que lorsque le capteur est offline. »
      //
      // Only TODAY can hold a future slot (the loop already stops at `todayIso`), and the
      // in-progress slot is NOT elapsed — the same boundary `dispatch/redispatch.ts` has drawn at
      // hour granularity since E6. A PAST slot with no reading still falls back to the grid: that
      // is the missed-report visibility she asked for on 01/09, and it is not what changed.
      const elapsed = (slot: number): boolean => date < todayIso || slot < nowSlot;
      const row = rowOf(date);
      const measuredSlots = hourlyByDate.get(date);

      if (measuredSlots !== undefined) {
        // ── the slot path: monthly_stats is NEVER added on top (double counting) ──
        // The four rules are UNCHANGED by slice C; only their granularity moved from the hour to
        // the half-hour. A slot with no reading is now genuinely empty, where the hour bucket used
        // to be carried by its other half — that is the point of the ruling (MEJ-8's invisible
        // outage), and it is why an hour whose readings cluster in one half MOVES the day total.
        const dayCells: PeriodCell[] = [];
        for (let slot = 0; slot < SLOTS_PER_DAY; slot += 1) {
          const cell = measuredSlots.get(slot);
          const gridHas = grid.has[row]?.[slot] === true && mayBackup && elapsed(slot);
          const gridValue = grid.values[row]?.[slot] ?? 0;
          // OFF-1 (Mejri, ruled 2026-09-02) — « les données forcées ne devraient être prises en
          // compte que lorsque le capteur est offline ». The manual grid stands in for a FAILURE;
          // while the sensor is up there is nothing to stand in for. `online` is the hub's own
          // judgement (a slot is offline only when it AND the previous one are silent — a single
          // gap is jitter); unknown behaves exactly as before, which is what makes this inert
          // until the hub sends the flag.
          //
          // THE FOUR STATES, in order:
          //   value > 0        → measured                                        (rule 1)
          //   value === 0      → online: a REAL zero · offline/unknown: the grid  (rule 2, gated)
          //   value === null   → online: NOT a data point · offline/unknown: grid (rule 3, gated)
          //   no cell at all   → the grid, as today                               (rule 3)
          const online = cell?.deviceOnline === true;
          if (cell !== undefined && cell.value !== null && cell.value > 0) {
            dayCells.push({ date, slot, value: cell.value, source: 'measured' }); // rule 1
          } else if (cell !== undefined && cell.value === 0) {
            // rule 2 — a measured ZERO from an ONLINE device is a real zero, not a backup trigger.
            if (!online && gridHas)
              dayCells.push({ date, slot, value: gridValue, source: 'backup' });
            else dayCells.push({ date, slot, value: 0, source: 'measured' });
          } else if (cell !== undefined && cell.value === null && online) {
            // The sensor was up and reported nothing: no measure, no backup, nothing has failed.
            continue;
          } else if (gridHas) {
            dayCells.push({ date, slot, value: gridValue, source: 'backup' }); // rule 3
          }
          // else: no measure, no grid cell → not a data point at all (the silent rule)
        }
        if (dayCells.length > 0) {
          cells.push(...dayCells);
          days.push({
            date,
            audience: dayAudience(dayCells),
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
        dayGranularityAudience += entry.audience;
        continue;
      }

      if (!mayBackup) continue;
      // ── the backup grid alone, cell by cell so S02 still sees this date ──
      const dayCells: PeriodCell[] = [];
      for (let slot = 0; slot < SLOTS_PER_DAY; slot += 1) {
        if (grid.has[row]?.[slot] === true && elapsed(slot)) {
          dayCells.push({ date, slot, value: grid.values[row]?.[slot] ?? 0, source: 'backup' });
        }
      }
      if (dayCells.length > 0) {
        cells.push(...dayCells);
        days.push({
          date,
          audience: dayAudience(dayCells),
          source: 'estimated',
          hasMeasured: false, // grid only — MEJ-R1's real target: never the peak
        });
      }
    }
  }

  const measuredDays = days.filter((d) => d.source === 'measured').length;
  const estimatedCells = cells.filter((c) => c.source === 'backup').length;
  const dataPoints = cells.length + dayGranularityMeasured;

  // The value-weighted share (see PeriodAudience.estimatedPct). Both sides are duration-weighted,
  // so the 0.5 cancels — it is written out anyway because the day-granularity term below is
  // already a whole day's audience, and mixing a level with a day total would be an easy silent
  // unit error.
  let estimatedAudience = 0;
  let cellAudience = 0;
  for (const cell of cells) {
    const weighted = cell.value * SLOT_HOURS;
    cellAudience += weighted;
    if (cell.source === 'backup') estimatedAudience += weighted;
  }
  const totalAudience = cellAudience + dayGranularityAudience;

  return {
    days,
    cells,
    total: days.reduce((sum, d) => sum + d.audience, 0),
    measuredDays,
    estimatedDays: days.length - measuredDays,
    estimatedPct:
      dataPoints === 0
        ? null // no data at all — the ONE meaning of null, which surfaces branch on
        : totalAudience === 0
          ? Math.round((estimatedCells / dataPoints) * 100) // degenerate: nobody to apportion
          : Math.round((estimatedAudience / totalAudience) * 100),
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
  const sums = new Array<number>(7 * SLOTS_PER_DAY).fill(0);
  const counts = new Array<number>(7 * SLOTS_PER_DAY).fill(0);
  const allMeasured = new Array<boolean>(7 * SLOTS_PER_DAY).fill(true);
  for (const cell of cells) {
    if (cell.slot < 0 || cell.slot >= SLOTS_PER_DAY) continue;
    const at = rowOf(cell.date) * SLOTS_PER_DAY + cell.slot;
    sums[at] = (sums[at] ?? 0) + cell.value;
    counts[at] = (counts[at] ?? 0) + 1;
    if (cell.source !== 'measured') allMeasured[at] = false;
  }
  return Array.from({ length: 7 }, (_, row) =>
    Array.from({ length: SLOTS_PER_DAY }, (__, slot) => {
      const at = row * SLOTS_PER_DAY + slot;
      const n = counts[at] ?? 0;
      if (n === 0) return { value: null, source: null };
      return {
        value: Math.round((sums[at] ?? 0) / n),
        source: allMeasured[at] === true ? ('measured' as const) : ('backup' as const),
      };
    }),
  );
}
