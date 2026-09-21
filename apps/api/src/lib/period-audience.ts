import { addDays, format, getDay, parseISO } from 'date-fns';

import type { MonthlyStatsDaily } from '../db/schema.js';

import { SLOTS_PER_DAY, hourOfSlot } from './half-hour-slots.js';
import { isMeasuredDay } from './monthly-audience.js';
import { isOpenSlot } from './opening-hours.js';
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
 *
 * ── LEARN-1 T3 (spec 2026-09-21, behind LEARNED_AFFLUENCE_ENABLED) ─────────────────────────────
 * With `input.learned` set, the HUB has computed everything (approach A) and a date that holds hub
 * cells takes them as they are: a slot outside the venue's CURRENT hours is ignored (rows stored
 * before the flag included); `value !== null` → measured (a 0 is a 0); else `estimate` → backup;
 * else not a data point. No grid, no device_online, no monthly_stats on such a date. A date with no
 * open hub cell keeps the path above. `learned === null` (flag off) runs the code above untouched.
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
  /**
   * LEARN-1 T2 — the hub's ready-made value for a slot it did NOT measure (its learned average, else
   * the typed seed), only ever beside `value: null`. Read only under the flag (`learned`); absent or
   * null = the hub had nothing to offer.
   */
  estimate?: number | null;
}

/**
 * LEARN-1 T3 — the one venue fact the learned merge needs. `PeriodAudienceInput.learned === null`
 * means the flag is OFF and the merge is today's, byte for byte.
 */
export interface LearnedMerge {
  /** The venue's CURRENT hours (screenhosts.opening_hour / closing_hour); either null = open all day. */
  openingHour: number | null;
  closingHour: number | null;
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
  /**
   * FLOW-4 — Σ of the day's HOUR values, each the exact mean of the cells it has. POSSIBLY
   * FRACTIONAL (an hour of 15 and 30 is 22.5) and deliberately not rounded here: the surfaces
   * round for display. `source` / `hasMeasured` stay CELL-based and are untouched by the fold.
   */
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
  /** Σ `days[].audience` — fractional whenever one of them is (FLOW-4). Not rounded here. */
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
   * FLOW-4 (2026-09-17) — the share is now taken PER HOUR, so its denominator is the same quantity
   * `total` is (Σ hour values, plus the day-granularity history). Within an hour the estimated
   * part is pro-rata the backup cells' share of that hour's readings. On equal halves of one
   * source the ratio is byte-identical to FLOW-1's.
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
  /**
   * LEARN-1 T3 — `null` = LEARNED_AFFLUENCE_ENABLED is off (today's merge). Required, like
   * `nowSlot` and `onboardedIso`: every caller states which merge it runs rather than inheriting one
   * by omission. Set by `loadPeriodAudienceInput` from the ONE switch and the venue's hours.
   */
  learned: LearnedMerge | null;
}

/** A zero-filled 7×48 Monday-first grid with nothing marked as filled. */
export const emptyBackupGrid = (): BackupGrid => ({
  values: Array.from({ length: 7 }, () => Array.from({ length: SLOTS_PER_DAY }, () => 0)),
  has: Array.from({ length: 7 }, () => Array.from({ length: SLOTS_PER_DAY }, () => false)),
});

/**
 * FLOW-4 (operator, ruled 2026-09-17) — a day's audience is the SUM of its HOUR VALUES.
 *
 * « everything works by the hour; only the readings come each 30 min. After we calculate the
 * average which results in the value of the hour, after that everything works by the hour. » The
 * half-hour cell is a READING, not a unit of audience: two readings describe the same hour, so
 * they are averaged into it, and only then does the hour become a term of the day.
 *
 * ── WHAT IT SUPERSEDES ─────────────────────────────────────────────────────────────────────────
 * FLOW-1 (Mejri, ruled 2026-09-04) said « a day's audience is the plain SUM of its cells », on the
 * grounds that a cell is what the sensor counted in that slot and the cells therefore PARTITION
 * the day: « la somme dans le Hub et Peak Hours est de 274 personnes, contre 137 personnes pour
 * les variables mentionnées ». That ruling is recorded, not erased — it is what the code did until
 * today, and it is why the numbers below move. The operator has taken the call knowingly: the hub
 * itself now folds readings into hours (its #97 / #99), and « keep the readings the same, don't
 * change history — it's just the calculation that will change. »
 *
 * ── THE RULE ───────────────────────────────────────────────────────────────────────────────────
 *   1. an hour's value is the EXACT mean of the cells it HAS (HOUR-AVG2, already shipped for the
 *      grids): a lone half IS the hour (it is never averaged against an absent reading), a
 *      measured 0 is a value and counts in the mean, an hour with no cell at all is not a term;
 *   2. the day is the plain sum of those hour values. So are the période, the week and the month —
 *      they are sums of days.
 *
 * Worked example (the operator's own): 09h holds 15 and 30 → the hour is 22.5; 10h holds a lone
 * 20 → the hour is 20; the day is 42.5. Under FLOW-1 the same cells read 65.
 *
 * CONSEQUENCE, expected and accepted: on a full-cadence day every day / week / période / month
 * audience figure roughly HALVES. Nothing else moves — no reading is rewritten, no history is
 * touched.
 *
 * NOTHING IS ROUNDED HERE. A day is legitimately fractional (42.5), and so is the période total
 * that sums days. The surfaces round for display (formatIntFr / formatDecimalFr); rounding at this
 * boundary would bias every sum above it.
 */
const dayAudience = (dayCells: readonly PeriodCell[]): number => {
  let total = 0;
  for (const hourCells of hoursOfDay(dayCells).values()) total += hourValue(hourCells);
  return total;
};

/** The cells of ONE day bucketed by the hour they fall in (`hourOfSlot`), insertion-ordered. */
const hoursOfDay = (dayCells: readonly PeriodCell[]): Map<number, PeriodCell[]> => {
  const byHour = new Map<number, PeriodCell[]>();
  for (const cell of dayCells) {
    const hour = hourOfSlot(cell.slot);
    const bucket = byHour.get(hour);
    if (bucket === undefined) byHour.set(hour, [cell]);
    else bucket.push(cell);
  }
  return byHour;
};

/** FLOW-4 rule 1 — the EXACT mean of the cells the hour has. Never empty by construction. */
const hourValue = (hourCells: readonly PeriodCell[]): number =>
  hourCells.reduce((sum, c) => sum + c.value, 0) / hourCells.length;

/** date-fns getDay: 0 = Sunday → the grid's Monday-first row index. */
const rowOf = (dateIso: string): number => (getDay(parseISO(dateIso)) + 6) % 7;

/** A day built from half-hour cells — AFF1's dayProvenance and MEJ-R2's peak flag, as the slot path states them. */
const slotDay = (date: string, dayCells: readonly PeriodCell[]): PeriodDay => ({
  date,
  audience: dayAudience(dayCells),
  source: dayCells.every((c) => c.source === 'measured') ? 'measured' : 'estimated',
  hasMeasured: dayCells.some((c) => c.source === 'measured'),
});

/**
 * LEARN-1 T3 — one hub date under the flag. The hub computed everything (approach A), so its cells
 * are taken as they are: a reading is `measured` (a 0 is a 0 — no device_online, no grid), an
 * unmeasured slot the hub could fill carries `estimate` and is `backup`, anything else is not a data
 * point. The hub already applied its own floor (the first reading) and sends ended slots only, so
 * neither `onboardedIso` nor the S02-FUT1 boundary is re-applied here. Closed slots never reach this
 * function (they are dropped when the hub dates are indexed).
 */
const learnedDayCells = (date: string, hubSlots: ReadonlyMap<number, HourlyCell>): PeriodCell[] => {
  const dayCells: PeriodCell[] = [];
  for (let slot = 0; slot < SLOTS_PER_DAY; slot += 1) {
    const hubCell = hubSlots.get(slot);
    if (hubCell === undefined) continue;
    if (hubCell.value !== null) {
      dayCells.push({ date, slot, value: hubCell.value, source: 'measured' });
    } else if (hubCell.estimate !== undefined && hubCell.estimate !== null) {
      dayCells.push({ date, slot, value: hubCell.estimate, source: 'backup' });
    }
  }
  return dayCells;
};

export function periodAudience(input: PeriodAudienceInput): PeriodAudience {
  const { months, hourly, grid, range, todayIso, nowSlot, onboardedIso, learned } = input;

  const measuredDayByDate = new Map<string, MonthlyStatsDaily>();
  for (const month of months) {
    for (const entry of month.daily) measuredDayByDate.set(entry.date, entry);
  }
  // date → (hour → measured value). A date PRESENT here takes the hour path, even if every one of
  // its cells is a zero: the hub sends measured zeros deliberately, so "the sensor said nothing"
  // and "the sensor counted nobody" stay distinguishable right up to this merge.
  const hourlyByDate = new Map<string, Map<number, HourlyCell>>();
  for (const cell of hourly) {
    // LEARN-1 T3 — under the flag a slot outside the venue's CURRENT hours is not a data point and
    // does not make its date a hub date: rows stored before the flag (the old pushes sent night
    // slots) are dropped here, before anything reads them. Off (`learned === null`): nothing is.
    if (learned !== null && !isOpenSlot(cell.slot, learned.openingHour, learned.closingHour)) {
      continue;
    }
    // LEARN-1 T3 — a legacy OFF-1 « record of silence » (value null, no estimate, device_online
    // set) predates the flag: the flagged hub rewrites every open row since the venue's first
    // reading WITHOUT device_online, so a row still carrying it is either before that first
    // reading or belongs to a venue never measured. Neither is a hub cell under the flag, so its
    // date keeps today's path (the typed grid from the floor) instead of going blank.
    if (
      learned !== null &&
      cell.value === null &&
      (cell.estimate === undefined || cell.estimate === null) &&
      cell.deviceOnline !== undefined &&
      cell.deviceOnline !== null
    ) {
      continue;
    }
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

      if (measuredSlots !== undefined && learned !== null) {
        // ── LEARN-1 T3: a hub date under the flag — the hub's cells as they are, nothing else ──
        const dayCells = learnedDayCells(date, measuredSlots);
        if (dayCells.length > 0) {
          cells.push(...dayCells);
          days.push(slotDay(date, dayCells));
        }
        continue;
      }

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

  // The value-weighted share (see PeriodAudience.estimatedPct). FLOW-4 — it is re-expressed PER
  // HOUR, because its denominator has to be the same quantity `total` is: a share of « people » is
  // a lie the moment the two count different people. So each hour contributes its own value (the
  // mean of its cells), and the estimated part of that value is pro-rata the backup cells' share
  // of the hour's readings — one measured half and one backup half do not make the hour half
  // estimated when the backup one carried a sixth of the readings.
  //
  // An hour whose cells sum to 0 has nothing to apportion and contributes 0 to BOTH sides (its
  // value is 0 anyway); the degenerate « data but no audience » case still falls back to the point
  // share below, so `null` keeps its one meaning.
  //
  // With both halves present and of the same source this is the RATIO FLOW-1 computed, byte for
  // byte: the factor 2 divided out of numerator and denominator alike. Day-granularity history
  // (the hub's whole-day totals) stays in the denominator exactly as before — it never carried a
  // per-hour shape to fold.
  let estimatedAudience = 0;
  let hourAudience = 0;
  const cellsByDate = new Map<string, PeriodCell[]>();
  for (const cell of cells) {
    const forDate = cellsByDate.get(cell.date);
    if (forDate === undefined) cellsByDate.set(cell.date, [cell]);
    else forDate.push(cell);
  }
  for (const dayCells of cellsByDate.values()) {
    for (const hourCells of hoursOfDay(dayCells).values()) {
      const readings = hourCells.reduce((sum, c) => sum + c.value, 0);
      if (readings === 0) continue; // nobody to apportion — 0 on both sides
      const backup = hourCells.reduce((sum, c) => (c.source === 'backup' ? sum + c.value : sum), 0);
      const value = readings / hourCells.length;
      hourAudience += value;
      estimatedAudience += value * (backup / readings);
    }
  }
  const totalAudience = hourAudience + dayGranularityAudience;

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

/**
 * ADM-OBS2 — one HOUR of the période, as FLOW-4 folds it: the exact mean of the half-hour cells
 * the hour has (`hourValue`), plus how many of those cells were measured and how many came from
 * the backup grid. The admin « Tests » page takes its min / median / mean / max over these, so its
 * statistics are made of the same hour values the day total sums.
 */
export interface PeriodHour {
  date: string; // YYYY-MM-DD
  hour: number; // 0–23
  /** POSSIBLY FRACTIONAL (15 and 30 → 22.5), not rounded here — the same contract as a day. */
  value: number;
  measuredCells: number;
  backupCells: number;
}

/** Every (date, hour) of the période that holds at least one cell, in date then hour order. */
export function periodHours(cells: readonly PeriodCell[]): PeriodHour[] {
  const cellsByDate = new Map<string, PeriodCell[]>();
  for (const cell of cells) {
    const forDate = cellsByDate.get(cell.date);
    if (forDate === undefined) cellsByDate.set(cell.date, [cell]);
    else forDate.push(cell);
  }
  const out: PeriodHour[] = [];
  for (const date of [...cellsByDate.keys()].sort()) {
    const byHour = hoursOfDay(cellsByDate.get(date) ?? []);
    for (const hour of [...byHour.keys()].sort((a, b) => a - b)) {
      const hourCells = byHour.get(hour) ?? [];
      const backupCells = hourCells.filter((c) => c.source === 'backup').length;
      out.push({
        date,
        hour,
        value: hourValue(hourCells),
        measuredCells: hourCells.length - backupCells,
        backupCells,
      });
    }
  }
  return out;
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
 * PEAK-MAX1 (Mejri, confirmed by the operator 2026-09-04) — a slot's value is the **HIGHEST**
 * in-effect value among the cells that fall on it, not their mean. « Peak means the highest value
 * ever recorded at a specific thirty-minute slot … it will be the same for months after unless
 * there is another thirty-minute slot that had a reading higher than the peak last recorded. » A
 * later, quieter week therefore never lowers a cell; only a higher reading raises it. This
 * supersedes her own spec sheet's « Audience moyenne … sur l'ensemble de la période ».
 *
 * The période scoping STAYS (she reported the section ignoring the filter as a defect on 04/08);
 * « Depuis le début » is what gives the all-time persistence she describes.
 *
 * Provenance is the source of the cell that HOLDS the max, with a measured cell winning a tie.
 * The old rule — one backup cell makes the whole slot an estimation — was a MEAN rule, and it was
 * right for a mean: an average containing an estimate is partly estimated. Under a max the number
 * displayed IS one cell's, so its provenance is that cell's; calling a sensor reading an
 * « estimation » because some other week's backup cell sat lower on the same slot would be false.
 *
 * Inputs are integers and the max of integers is an integer, so nothing is rounded here — the
 * wire's integer contract holds without a Math.round.
 */
export function weekGridFromCells(cells: PeriodCell[]): WeekCell[][] {
  // Flat 7×SLOTS_PER_DAY accumulators — indexed arithmetic, no nested optional chains to appease.
  // `null` in `peaks` means « no cell here yet » and survives to the output as the ONE meaning of
  // null: hachure. It is never a coloured 0, which is why the emptiness test is `=== null` and not
  // a falsy check — a genuine reading of 0 is a data point and must keep its cell.
  const peaks = new Array<number | null>(7 * SLOTS_PER_DAY).fill(null);
  const peakMeasured = new Array<boolean>(7 * SLOTS_PER_DAY).fill(false);
  for (const cell of cells) {
    if (cell.slot < 0 || cell.slot >= SLOTS_PER_DAY) continue;
    const at = rowOf(cell.date) * SLOTS_PER_DAY + cell.slot;
    const best = peaks[at];
    const measured = cell.source === 'measured';
    if (best === null || best === undefined || cell.value > best) {
      peaks[at] = cell.value;
      peakMeasured[at] = measured;
    } else if (cell.value === best && measured) {
      // Tie between a measured and a backup cell of the same value: measured wins, so the number
      // is never disclosed as an estimation when a sensor observed exactly it.
      peakMeasured[at] = true;
    }
  }
  return Array.from({ length: 7 }, (_, row) =>
    Array.from({ length: SLOTS_PER_DAY }, (__, slot) => {
      const at = row * SLOTS_PER_DAY + slot;
      const peak = peaks[at];
      if (peak === null || peak === undefined) return { value: null, source: null };
      return {
        value: peak,
        source: peakMeasured[at] === true ? ('measured' as const) : ('backup' as const),
      };
    }),
  );
}
