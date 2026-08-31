import { describe, expect, it } from 'vitest';

import {
  type BackupGrid,
  type HourlyCell,
  type PeriodAudienceInput,
  emptyBackupGrid,
  periodAudience,
  weekGridFromCells,
} from '../src/lib/period-audience.js';

// AUD-HOURLY1-C (amendment 2026-08-31) — THE merge is per (date, hour), not per day.
//
// Mejri unplugged the sensor, waited, and « rien ne s'est passé »: the day-level merge treated a
// day carrying ANY reading as measured wholesale, so the dark hour could never fall back to the
// admin's grid. Per (date, hour): measured > 0 wins; a measured ZERO defers to the grid cell if
// the admin filled one (else the zero stands — no cell means outside opening hours); no measured
// cell takes the grid cell if one exists, else it is not a data point at all. The MEJ-2 onboarding
// floor bounds BACKUP ONLY.

const TODAY = '2026-08-31'; // a Monday
const MONDAY = 1;
const TUESDAY = 2;

/** A backup grid with the given (isoDay 1=Mon..7, hour, value) cells FILLED by the admin. */
const gridWith = (cells: [day: number, hour: number, value: number][]): BackupGrid => {
  const grid = emptyBackupGrid();
  for (const [day, hour, value] of cells) {
    grid.values[day - 1]![hour] = value;
    grid.has[day - 1]![hour] = true;
  }
  return grid;
};

const hours = (date: string, pairs: [hour: number, value: number][]): HourlyCell[] =>
  pairs.map(([hour, value]) => ({ date, hour, value }));

const input = (over: Partial<PeriodAudienceInput> = {}): PeriodAudienceInput => ({
  months: [],
  hourly: [],
  grid: emptyBackupGrid(),
  range: { from: TODAY, to: TODAY },
  todayIso: TODAY,
  onboardedIso: null,
  ...over,
});

describe("AUD-HOURLY1-C — Mejri's scenario: the sensor goes dark for ONE hour", () => {
  // The venue is open 9h and 10h. The sensor measured 9h (12 people) and then went dark at 10h,
  // which the hub reports as a measured ZERO. The admin's grid covers 10h with 30.
  const grid = gridWith([
    [MONDAY, 9, 25],
    [MONDAY, 10, 30],
  ]);
  const result = periodAudience(
    input({
      hourly: hours(TODAY, [
        [9, 12],
        [10, 0], // ← the outage the day-level merge used to swallow
      ]),
      grid,
    }),
  );

  it('the outage hour renders the FORCED grid value with source backup', () => {
    expect(result.cells).toEqual([
      { date: TODAY, hour: 9, value: 12, source: 'measured' },
      { date: TODAY, hour: 10, value: 30, source: 'backup' }, // not 0, and not « measured »
    ]);
  });

  it("S01's total carries the forced value — « rien ne s'est passé » is over", () => {
    expect(result.total).toBe(42); // 12 measured + 30 backup, NOT 12
    expect(result.days).toEqual([{ date: TODAY, audience: 42, source: 'estimated' }]);
    // One backup hour makes the DAY an estimation (AFF1's dayProvenance ruling), so it can never
    // become the « Pic d'audience » (MEJ-R1).
    expect(result.measuredDays).toBe(0);
  });

  it("S02's cell for that slot is the backup value, marked as an estimation", () => {
    const week = weekGridFromCells(result.cells);
    expect(week[MONDAY - 1]![10]).toEqual({ value: 30, source: 'backup' });
    expect(week[MONDAY - 1]![9]).toEqual({ value: 12, source: 'measured' });
  });

  it('the caption counts CELLS: one of the two data points is estimated → 50 %', () => {
    expect(result.estimatedPct).toBe(50);
  });
});

describe('AUD-HOURLY1-C — the four merge rules', () => {
  it('rule 1: a measured cell above zero wins over the grid', () => {
    const result = periodAudience(
      input({ hourly: hours(TODAY, [[9, 12]]), grid: gridWith([[MONDAY, 9, 999]]) }),
    );
    expect(result.cells).toEqual([{ date: TODAY, hour: 9, value: 12, source: 'measured' }]);
  });

  it('rule 2: a measured ZERO defers to the grid cell when the admin filled one', () => {
    const result = periodAudience(
      input({ hourly: hours(TODAY, [[9, 0]]), grid: gridWith([[MONDAY, 9, 30]]) }),
    );
    expect(result.cells).toEqual([{ date: TODAY, hour: 9, value: 30, source: 'backup' }]);
  });

  it('rule 2: a measured ZERO STANDS where the grid has no cell (outside opening hours)', () => {
    // An empty grid isolates the rule: 3h is not an opening hour by the hub's own definition
    // (« opening hours » = the cells the admin filled), so the zero is the honest answer.
    const result = periodAudience(
      input({ hourly: hours(TODAY, [[3, 0]]), grid: emptyBackupGrid() }),
    );
    expect(result.cells).toEqual([{ date: TODAY, hour: 3, value: 0, source: 'measured' }]);
    expect(result.days).toEqual([{ date: TODAY, audience: 0, source: 'measured' }]);
  });

  it('rules 2 and 3 together: the dark hour stands at 0, a never-measured open hour is filled', () => {
    const result = periodAudience(
      input({ hourly: hours(TODAY, [[3, 0]]), grid: gridWith([[MONDAY, 9, 30]]) }),
    );
    expect(result.cells).toEqual([
      { date: TODAY, hour: 3, value: 0, source: 'measured' }, // closed hour, zero stands
      { date: TODAY, hour: 9, value: 30, source: 'backup' }, // open hour with no measure, filled
    ]);
  });

  it('rule 3: no measured cell takes the grid cell; an hour with neither is NOT a data point', () => {
    const result = periodAudience(
      input({
        hourly: hours(TODAY, [[9, 5]]), // the date has cells, so it takes the hour path
        grid: gridWith([[MONDAY, 11, 40]]),
      }),
    );
    expect(result.cells).toEqual([
      { date: TODAY, hour: 9, value: 5, source: 'measured' },
      { date: TODAY, hour: 11, value: 40, source: 'backup' },
    ]);
    // 10h has no measure and no grid cell → absent, so it cannot drag the averages down.
    expect(result.cells.some((c) => c.hour === 10)).toBe(false);
  });

  it('rule 4: the floor bounds BACKUP only — a measurement before it always counts', () => {
    const result = periodAudience(
      input({
        range: { from: '2026-08-24', to: TODAY }, // 24/08 is a Monday, before the floor
        hourly: [...hours('2026-08-24', [[9, 7]]), ...hours(TODAY, [[9, 0]])],
        grid: gridWith([[MONDAY, 9, 30]]),
        onboardedIso: '2026-08-26',
      }),
    );
    expect(result.cells).toEqual([
      // The pre-floor MEASUREMENT is a fact about the venue and stays…
      { date: '2026-08-24', hour: 9, value: 7, source: 'measured' },
      // …while the post-floor measured zero may defer to the grid.
      { date: TODAY, hour: 9, value: 30, source: 'backup' },
    ]);
  });

  it('rule 4: a measured ZERO before the floor stands — backup may not fill it', () => {
    const result = periodAudience(
      input({
        range: { from: '2026-08-24', to: '2026-08-24' },
        hourly: hours('2026-08-24', [[9, 0]]),
        grid: gridWith([[MONDAY, 9, 30]]),
        onboardedIso: '2026-08-26',
      }),
    );
    expect(result.cells).toEqual([{ date: '2026-08-24', hour: 9, value: 0, source: 'measured' }]);
  });

  it('rule 4: the backup grid alone never answers for days before the floor', () => {
    const result = periodAudience(
      input({
        range: { from: '2026-08-17', to: TODAY }, // three Mondays: 17, 24, 31
        grid: gridWith([[MONDAY, 9, 30]]),
        onboardedIso: '2026-08-26',
      }),
    );
    expect(result.days).toEqual([{ date: TODAY, audience: 30, source: 'estimated' }]);
  });
});

describe('AUD-HOURLY1-C — day precedence (the rolling 35-day window)', () => {
  const months = [
    {
      month: '2026-08',
      daily: [
        { date: TODAY, audience: 900, source: 'measured' as const },
        { date: '2026-07-27', audience: 400, source: 'measured' as const },
      ],
    },
  ];

  it('a date WITH hourly cells builds from hours and never adds monthly_stats on top', () => {
    const result = periodAudience(
      input({
        months,
        hourly: hours(TODAY, [[9, 12]]),
        grid: gridWith([[MONDAY, 9, 30]]),
      }),
    );
    // 12, not 912 and not 900 — the hourly window owns this date.
    expect(result.total).toBe(12);
    expect(result.days).toEqual([{ date: TODAY, audience: 12, source: 'measured' }]);
  });

  it('history older than the window still reads from monthly_stats, at DAY granularity', () => {
    const result = periodAudience(
      input({
        range: { from: '2026-07-27', to: '2026-07-27' }, // a Monday, outside the hourly window
        months,
        grid: gridWith([[MONDAY, 9, 30]]),
      }),
    );
    expect(result.days).toEqual([{ date: '2026-07-27', audience: 400, source: 'measured' }]);
    expect(result.cells).toEqual([]); // no hour detail → contributes nothing to S02
  });

  it('a measured history day is a MEASURED data point in the caption denominator', () => {
    // 27/07 measured at day granularity + 31/08 from a single backup cell.
    const result = periodAudience(
      input({
        range: { from: '2026-07-27', to: TODAY },
        months: [{ month: '2026-08', daily: months[0]!.daily }],
        grid: gridWith([[MONDAY, 9, 30]]),
      }),
    );
    // Cells alone would read 100 % estimated and hide the measured history.
    const measuredHistoryDays = result.days.filter((d) => d.source === 'measured').length;
    expect(measuredHistoryDays).toBeGreaterThan(0);
    expect(result.estimatedPct).toBeLessThan(100);
  });

  it('a day with neither hours, nor a measured total, nor a grid cell is not a data day', () => {
    const result = periodAudience(input({ grid: emptyBackupGrid() }));
    expect(result.days).toEqual([]);
    expect(result.cells).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.estimatedPct).toBeNull();
  });

  it('never claims a day that has not happened', () => {
    const result = periodAudience(
      input({
        range: { from: TODAY, to: '2026-09-15' },
        grid: gridWith([
          [MONDAY, 9, 30],
          [TUESDAY, 9, 30],
        ]),
      }),
    );
    expect(result.days.map((d) => d.date)).toEqual([TODAY]);
  });
});

describe('weekGridFromCells — S02 is the période folded into a weekday × hour grid', () => {
  it('averages the cells that fall on a slot and rounds', () => {
    const week = weekGridFromCells([
      { date: '2026-08-24', hour: 9, value: 10, source: 'measured' }, // Monday
      { date: TODAY, hour: 9, value: 15, source: 'measured' }, // Monday
    ]);
    expect(week[MONDAY - 1]![9]).toEqual({ value: 13, source: 'measured' }); // 12.5 → 13
  });

  it('one backup cell makes the whole slot an estimation (the AFF1 ruling)', () => {
    const week = weekGridFromCells([
      { date: '2026-08-24', hour: 9, value: 10, source: 'measured' },
      { date: TODAY, hour: 9, value: 30, source: 'backup' },
    ]);
    expect(week[MONDAY - 1]![9]).toEqual({ value: 20, source: 'backup' });
  });

  it('a slot the période holds no cell for is null — hachured, never a coloured 0', () => {
    const week = weekGridFromCells([{ date: TODAY, hour: 9, value: 10, source: 'measured' }]);
    expect(week[MONDAY - 1]![10]).toEqual({ value: null, source: null });
    expect(week[TUESDAY - 1]![9]).toEqual({ value: null, source: null });
  });

  it('an empty période yields an all-null grid, not zeros', () => {
    const week = weekGridFromCells([]);
    expect(week).toHaveLength(7);
    expect(week.every((row) => row.every((c) => c.value === null && c.source === null))).toBe(true);
  });
});
