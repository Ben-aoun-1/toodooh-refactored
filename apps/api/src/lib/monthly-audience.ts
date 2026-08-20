import { addDays, format, getDay, parseISO } from 'date-fns';

import type { MonthlyStatsDaily } from '../db/schema.js';

/**
 * PERF-QA2 — THE monthly audience source, merged.
 *
 * DIAGNOSIS (architect, 2026-08-20): « Personnes touchées » read Σ monthly_stats.total_audience,
 * a column fed exclusively by the hub's MEASURED pipeline. The fleet has never been online, so
 * every push carried zeros and the hero read 0 — while « Votre audience » on the owner dashboard
 * read the merged affluence grid and showed thousands. Two sources contradicting each other on
 * one page family.
 *
 * THE CONTRACT (one occupancy source): a month's audience is the sum of its days, and each DAY is
 * measured when a measurement exists, estimated from the venue's typical-week grid otherwise.
 * Never both — a day is counted once. Measured data therefore replaces estimates automatically
 * as it arrives (the ingest re-merges every push against the hub's fresh payload), exactly as the
 * hub venue page promises.
 *
 * WHAT "MEASURED" MEANS HERE: the hub has no null in its wire shape — an unmeasured day arrives
 * as 0 — so a day counts as measured when it carries `source: 'measured'` (written by this
 * module) or, for rows predating the marker, when its audience is > 0. That is the honest reading
 * of the data we have; it is stated at CF-9 rather than hidden.
 */

export type DailySource = 'measured' | 'estimated';

export interface MergedDaily {
  date: string; // YYYY-MM-DD
  audience: number;
  source: DailySource;
}

export interface MergeMonthlyAudienceInput {
  /** 'YYYY-MM'. */
  month: string;
  /** What the hub sent (ingest) or what is stored (backfill). May be partial or empty. */
  measured: MonthlyStatsDaily[];
  /** The venue's 7×24 typical-week grid, Monday-first (row 0 = Monday), zero-filled. */
  grid: number[][];
  /** Tunis today — the CURRENT month never claims audience for days that have not happened. */
  todayIso: string;
}

export interface MergedMonth {
  daily: MergedDaily[];
  totalAudience: number;
}

/** Σ of a weekday's 24 grid cells — the venue's estimated audience for a day of that weekday. */
export function estimatedDayAudience(grid: number[][], dateIso: string): number {
  const parsed = parseISO(dateIso);
  if (Number.isNaN(parsed.getTime())) return 0;
  const row = grid[(getDay(parsed) + 6) % 7]; // date-fns: 0 = Sunday → Monday-first rows
  if (!row) return 0;
  return row.reduce((sum, value) => sum + value, 0);
}

/**
 * A stored/pushed day counts as MEASURED when it says so, or (legacy rows, written before the
 * marker existed) when it carries a non-zero audience. An unmarked 0 is "the sensor said
 * nothing", which is what the whole defect was about.
 */
const isMeasured = (entry: MonthlyStatsDaily | undefined): entry is MonthlyStatsDaily =>
  entry !== undefined &&
  (entry.source === 'measured' || (entry.source === undefined && entry.audience > 0));

/** The last day the month may claim: its own end, or Tunis today for the CURRENT month. */
export function lastClaimableDay(month: string, todayIso: string): string | null {
  const currentMonth = todayIso.slice(0, 7);
  if (month > currentMonth) return null; // a future month claims nothing
  if (month === currentMonth) return todayIso;
  const first = parseISO(`${month}-01`);
  if (Number.isNaN(first.getTime())) return null;
  let cursor = first;
  let last = format(cursor, 'yyyy-MM-dd');
  for (;;) {
    cursor = addDays(cursor, 1);
    const iso = format(cursor, 'yyyy-MM-dd');
    if (!iso.startsWith(`${month}-`)) return last;
    last = iso;
  }
}

/**
 * The month's merged days + total. IDEMPOTENT: feeding this function its own output yields the
 * same output for a stable grid — measured days are kept as measured, and estimated days are
 * recomputed from the same grid to the same value. That is what makes the backfill re-runnable.
 */
export function mergeMonthlyAudience(input: MergeMonthlyAudienceInput): MergedMonth {
  const { month, measured, grid, todayIso } = input;
  const last = lastClaimableDay(month, todayIso);
  if (last === null) return { daily: [], totalAudience: 0 };

  const byDate = new Map(measured.map((entry) => [entry.date, entry]));
  const daily: MergedDaily[] = [];
  for (
    let cursor = parseISO(`${month}-01`);
    !Number.isNaN(cursor.getTime()) && format(cursor, 'yyyy-MM-dd') <= last;
    cursor = addDays(cursor, 1)
  ) {
    const date = format(cursor, 'yyyy-MM-dd');
    const entry = byDate.get(date);
    if (isMeasured(entry)) {
      daily.push({ date, audience: entry.audience, source: 'measured' });
      continue;
    }
    // No measurement → the estimate stands in. A venue with no grid either derives 0 here and
    // stays honestly at zero (the source still reads 'estimated': nothing was measured).
    daily.push({ date, audience: estimatedDayAudience(grid, date), source: 'estimated' });
  }
  return { daily, totalAudience: daily.reduce((sum, d) => sum + d.audience, 0) };
}

/**
 * Peak weekday (1 = Mon … 7 = Sun) and peak hour (0–23) of a grid — needed only when the backfill
 * CREATES a month row (both columns are NOT NULL). A hub push overwrites them with its own.
 */
export function gridPeaks(grid: number[][]): { peakDayOfWeek: number; peakHour: number } {
  let peakDayOfWeek = 1;
  let bestDay = -1;
  grid.forEach((row, index) => {
    const total = row.reduce((sum, value) => sum + value, 0);
    if (total > bestDay) {
      bestDay = total;
      peakDayOfWeek = index + 1;
    }
  });
  let peakHour = 0;
  let bestHour = -1;
  for (let hour = 0; hour < 24; hour += 1) {
    const total = grid.reduce((sum, row) => sum + (row[hour] ?? 0), 0);
    if (total > bestHour) {
      bestHour = total;
      peakHour = hour;
    }
  }
  return { peakDayOfWeek, peakHour };
}
