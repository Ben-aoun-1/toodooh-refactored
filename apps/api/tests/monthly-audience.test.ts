import { describe, expect, it } from 'vitest';

import type { MonthlyStatsDaily } from '../src/db/schema.js';
import {
  estimatedDayAudience,
  gridPeaks,
  lastClaimableDay,
  mergeMonthlyAudience,
} from '../src/lib/monthly-audience.js';

// PERF-QA2 — the merged monthly-audience source. « Personnes touchées » read Σ
// monthly_stats.total_audience, fed only by the measured pipeline (fleet never online → always
// 0), while « Votre audience » read the affluence grid and showed thousands. One contract now:
// a day is MEASURED when a measurement exists, ESTIMATED from the typical week otherwise, never
// both.

/** Mon–Fri 10/20/30 at 10h/11h/12h (Σ 60/day); Sat–Sun closed (Σ 0). */
const grid = (): number[][] =>
  Array.from({ length: 7 }, (_, day) =>
    Array.from({ length: 24 }, (_, hour) => {
      if (day >= 5) return 0;
      return hour === 10 ? 10 : hour === 11 ? 20 : hour === 12 ? 30 : 0;
    }),
  );

const TODAY = '2026-07-08';

describe('estimatedDayAudience', () => {
  it('sums the weekday row of the grid (Monday-first)', () => {
    expect(estimatedDayAudience(grid(), '2026-06-01')).toBe(60); // a Monday
    expect(estimatedDayAudience(grid(), '2026-06-06')).toBe(0); // a Saturday, closed
  });

  it('a venue with no grid estimates 0 — honestly, never a guess', () => {
    const empty = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
    expect(estimatedDayAudience(empty, '2026-06-01')).toBe(0);
  });

  it('a malformed date is 0, not a throw', () => {
    expect(estimatedDayAudience(grid(), 'pas-une-date')).toBe(0);
  });
});

describe('lastClaimableDay', () => {
  it('a closed month claims all of its days', () => {
    expect(lastClaimableDay('2026-06', TODAY)).toBe('2026-06-30');
    expect(lastClaimableDay('2026-02', TODAY)).toBe('2026-02-28');
  });

  it('the CURRENT month stops at Tunis today — never a day that has not happened', () => {
    expect(lastClaimableDay('2026-07', TODAY)).toBe(TODAY);
  });

  it('a future month claims nothing', () => {
    expect(lastClaimableDay('2026-08', TODAY)).toBeNull();
  });
});

describe('mergeMonthlyAudience', () => {
  it('an all-zero hub payload becomes the ESTIMATE (the fffrfr defect, in one function)', () => {
    const measured: MonthlyStatsDaily[] = Array.from({ length: 30 }, (_, i) => ({
      date: `2026-06-${String(i + 1).padStart(2, '0')}`,
      audience: 0,
    }));
    const merged = mergeMonthlyAudience({
      month: '2026-06',
      measured,
      grid: grid(),
      todayIso: TODAY,
    });
    // June 2026: 22 weekdays × 60 = 1320; weekends contribute 0.
    expect(merged.totalAudience).toBe(1320);
    expect(merged.daily).toHaveLength(30);
    expect(merged.daily.every((d) => d.source === 'estimated')).toBe(true);
  });

  it('a MEASURED day wins over its estimate and is never double-counted', () => {
    const merged = mergeMonthlyAudience({
      month: '2026-06',
      measured: [{ date: '2026-06-01', audience: 500, source: 'measured' }],
      grid: grid(),
      todayIso: TODAY,
    });
    const first = merged.daily.find((d) => d.date === '2026-06-01');
    expect(first).toEqual({ date: '2026-06-01', audience: 500, source: 'measured' });
    // 500 replaces that Monday's 60 — the month is 1320 − 60 + 500.
    expect(merged.totalAudience).toBe(1760);
  });

  it('LEGACY rows (no source marker) read as measured only when non-zero', () => {
    const merged = mergeMonthlyAudience({
      month: '2026-06',
      measured: [
        { date: '2026-06-01', audience: 500 }, // legacy, non-zero → a real measurement
        { date: '2026-06-02', audience: 0 }, // legacy zero → "the sensor said nothing"
      ],
      grid: grid(),
      todayIso: TODAY,
    });
    expect(merged.daily.find((d) => d.date === '2026-06-01')?.source).toBe('measured');
    expect(merged.daily.find((d) => d.date === '2026-06-02')).toEqual({
      date: '2026-06-02',
      audience: 60,
      source: 'estimated',
    });
  });

  it('fills days the hub never sent (a partial payload is not a hole in the month)', () => {
    const merged = mergeMonthlyAudience({
      month: '2026-06',
      measured: [{ date: '2026-06-15', audience: 100, source: 'measured' }],
      grid: grid(),
      todayIso: TODAY,
    });
    expect(merged.daily).toHaveLength(30);
    expect(merged.daily.filter((d) => d.source === 'measured')).toHaveLength(1);
  });

  it('the CURRENT month stops at today; a FUTURE month yields nothing', () => {
    const current = mergeMonthlyAudience({
      month: '2026-07',
      measured: [],
      grid: grid(),
      todayIso: TODAY,
    });
    expect(current.daily.at(-1)?.date).toBe(TODAY);
    expect(
      mergeMonthlyAudience({ month: '2026-08', measured: [], grid: grid(), todayIso: TODAY }),
    ).toEqual({ daily: [], totalAudience: 0 });
  });

  it('a venue with NEITHER measurements NOR a grid stays honestly at 0', () => {
    const empty = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
    const merged = mergeMonthlyAudience({
      month: '2026-06',
      measured: [],
      grid: empty,
      todayIso: TODAY,
    });
    expect(merged.totalAudience).toBe(0);
    expect(merged.daily.every((d) => d.audience === 0)).toBe(true);
  });

  it('IS IDEMPOTENT — merging its own output changes nothing (the backfill re-run proof)', () => {
    const once = mergeMonthlyAudience({
      month: '2026-06',
      measured: [{ date: '2026-06-01', audience: 500, source: 'measured' }],
      grid: grid(),
      todayIso: TODAY,
    });
    const twice = mergeMonthlyAudience({
      month: '2026-06',
      measured: once.daily,
      grid: grid(),
      todayIso: TODAY,
    });
    expect(twice).toEqual(once);
    const thrice = mergeMonthlyAudience({
      month: '2026-06',
      measured: twice.daily,
      grid: grid(),
      todayIso: TODAY,
    });
    expect(thrice).toEqual(once);
  });

  it('a later REAL measurement displaces the estimate it replaced (no accumulation)', () => {
    const estimated = mergeMonthlyAudience({
      month: '2026-06',
      measured: [],
      grid: grid(),
      todayIso: TODAY,
    });
    expect(estimated.totalAudience).toBe(1320);
    // The hub finally measures June: its fresh payload — not the stored estimates — is the input.
    const remeasured = mergeMonthlyAudience({
      month: '2026-06',
      measured: [{ date: '2026-06-01', audience: 900, source: 'measured' }],
      grid: grid(),
      todayIso: TODAY,
    });
    expect(remeasured.totalAudience).toBe(1320 - 60 + 900);
  });
});

describe('gridPeaks', () => {
  it('names the busiest weekday (1 = Mon) and hour of the grid', () => {
    const g = grid();
    const row = g[2];
    if (row) row[12] = 100; // make Wednesday the busiest day
    expect(gridPeaks(g)).toEqual({ peakDayOfWeek: 3, peakHour: 12 });
  });
});
