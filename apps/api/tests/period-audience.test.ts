import { describe, expect, it } from 'vitest';

import { periodAudience, weekdaysInRange } from '../src/lib/period-audience.js';

// PERF-R1 (operator 2026-08-30, supersedes US-P.5 « measured-only ») — THE period merge helper:
// for each day of the période, the PAX measure if one exists for that day, else the venue's
// hub-pushed affluence grid stands in (screenhost_affluence IS the hub's per-cell PAX-first
// merge). Never a zero because the sensor was silent; provenance is carried per day.

const TODAY = '2026-08-30';

/** A 7×24 zero grid with the given (day 1=Mon..7, hour, value) cells set. */
const gridWith = (cells: [day: number, hour: number, value: number][]): number[][] => {
  const grid = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
  for (const [day, hour, value] of cells) grid[day - 1]![hour] = value;
  return grid;
};

describe('periodAudience — PAX day first, backup grid otherwise', () => {
  // 2026-08-03 is a Monday.
  const months = [
    {
      month: '2026-08',
      daily: [
        { date: '2026-08-03', audience: 500, source: 'measured' as const },
        { date: '2026-08-04', audience: 0 }, // unmarked 0 = the sensor said nothing
      ],
    },
  ];
  const grid = gridWith([
    [1, 10, 100],
    [1, 11, 50], // Monday estimate 150 — must NOT override the 500 measure
    [2, 9, 80], // Tuesday estimate 80 — stands in for the silent day
    [3, 18, 250], // Wednesday estimate 250 — stands in for the absent day
  ]);

  it('a measured day keeps its PAX value; silent and absent days take the grid estimate', () => {
    const result = periodAudience({
      months,
      grid,
      range: { from: '2026-08-03', to: '2026-08-05' },
      todayIso: TODAY,
    });
    expect(result.days).toEqual([
      { date: '2026-08-03', audience: 500, source: 'measured' },
      { date: '2026-08-04', audience: 80, source: 'estimated' },
      { date: '2026-08-05', audience: 250, source: 'estimated' },
    ]);
    expect(result.total).toBe(830);
    expect(result.measuredDays).toBe(1);
    expect(result.estimatedDays).toBe(2);
    expect(result.estimatedPct).toBe(67); // 2/3, rounded
  });

  it('never a zero because the sensor was silent: no stats rows at all → the grid carries every day', () => {
    const result = periodAudience({
      months: [],
      grid,
      range: { from: '2026-08-03', to: '2026-08-04' },
      todayIso: TODAY,
    });
    expect(result.days).toEqual([
      { date: '2026-08-03', audience: 150, source: 'estimated' },
      { date: '2026-08-04', audience: 80, source: 'estimated' },
    ]);
    expect(result.estimatedPct).toBe(100);
  });

  it('a day with neither measure nor grid value is NOT a data day — no fake zeros', () => {
    const result = periodAudience({
      months: [],
      grid: gridWith([]),
      range: { from: '2026-08-03', to: '2026-08-04' },
      todayIso: TODAY,
    });
    expect(result.days).toEqual([]); // nothing measured, nothing to stand in → no data days
    expect(result.total).toBe(0);
    expect(result.measuredDays).toBe(0);
    expect(result.estimatedPct).toBeNull();
    // But a MEASURED zero is a measurement — it stays a data day.
    const measuredZero = periodAudience({
      months: [
        { month: '2026-08', daily: [{ date: '2026-08-03', audience: 0, source: 'measured' }] },
      ],
      grid: gridWith([]),
      range: { from: '2026-08-03', to: '2026-08-04' },
      todayIso: TODAY,
    });
    expect(measuredZero.days).toEqual([{ date: '2026-08-03', audience: 0, source: 'measured' }]);
    expect(measuredZero.measuredDays).toBe(1);
  });

  it('respects the period bounds and never claims a day that has not happened', () => {
    // A full-week grid so the clamp assertion is weekday-agnostic.
    const fullWeek = gridWith(Array.from({ length: 7 }, (_, i) => [i + 1, 10, 60]));
    const wide = periodAudience({
      months,
      grid: fullWeek,
      range: { from: '2026-08-04', to: '2026-09-15' }, // to > today
      todayIso: TODAY,
    });
    expect(wide.days[0]?.date).toBe('2026-08-04'); // from is inclusive; the 03 measure is out
    expect(wide.days.at(-1)?.date).toBe(TODAY); // clamped to today — no future day
    const future = periodAudience({
      months,
      grid: fullWeek,
      range: { from: '2026-09-01', to: '2026-09-15' }, // entirely in the future
      todayIso: TODAY,
    });
    expect(future.days).toEqual([]);
    expect(future.total).toBe(0);
    expect(future.estimatedPct).toBeNull();
  });
});

describe('weekdaysInRange — the S02 période mask (PERF-R2)', () => {
  it('lists the ISO weekdays (1=Mon..7=Sun) the période actually contains', () => {
    expect([...weekdaysInRange({ from: '2026-08-03', to: '2026-08-04' })].sort()).toEqual([1, 2]);
    expect([...weekdaysInRange({ from: '2026-08-01', to: '2026-08-02' })].sort()).toEqual([6, 7]);
  });

  it('a période of 7+ days keeps every weekday; an inverted one keeps none', () => {
    expect(weekdaysInRange({ from: '2026-08-01', to: '2026-08-07' }).size).toBe(7);
    expect(weekdaysInRange({ from: '2026-08-01', to: '2027-08-01' }).size).toBe(7);
    expect(weekdaysInRange({ from: '2026-08-04', to: '2026-08-03' }).size).toBe(0);
  });
});
