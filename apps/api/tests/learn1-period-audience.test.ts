import { describe, expect, it } from 'vitest';

import { addIsoDays } from '../src/lib/opening-hours.js';
import {
  type BackupGrid,
  type HourlyCell,
  type LearnedMerge,
  type PeriodAudienceInput,
  emptyBackupGrid,
  periodAudience,
  weekGridFromCells,
} from '../src/lib/period-audience.js';

// LEARN-1 T3 (spec 2026-09-21 §5) — under LEARNED_AFFLUENCE_ENABLED a date that holds hub cells
// takes them AS THEY ARE: a slot outside the venue's CURRENT hours is ignored (rows stored before the
// flag included); `value` is measured (a 0 is a 0); else `estimate` is backup; else no data point.
// No grid and no device_online on such a date. Dates without hub cells keep today's path (monthly
// day total, else the grid from the floor). Flag off (`learned: null`) is today, byte for byte.

const TODAY = '2026-09-21'; // a Monday
const MONDAY = 1;
const OPEN_8_22: LearnedMerge = { openingHour: 8, closingHour: 22 };

/** A backup grid with the given (isoDay 1=Mon..7, HOUR, value) cells filled, both halves. */
const gridWith = (cells: [day: number, hour: number, value: number][]): BackupGrid => {
  const grid = emptyBackupGrid();
  for (const [day, hour, value] of cells) {
    for (const slot of [hour * 2, hour * 2 + 1]) {
      grid.values[day - 1]![slot] = value;
      grid.has[day - 1]![slot] = true;
    }
  }
  return grid;
};

/** One hub cell as the flagged hub sends it — `estimate` only ever beside `value: null`. */
const cell = (date: string, slot: number, value: number | null, estimate?: number): HourlyCell =>
  estimate === undefined ? { date, slot, value } : { date, slot, value, estimate };

const input = (over: Partial<PeriodAudienceInput> = {}): PeriodAudienceInput => ({
  months: [],
  hourly: [],
  grid: emptyBackupGrid(),
  range: { from: TODAY, to: TODAY },
  todayIso: TODAY,
  nowSlot: 48, // the whole day has elapsed — the hub sends ended slots only
  onboardedIso: null,
  learned: OPEN_8_22,
  ...over,
});

const datesBetween = (from: string, to: string): string[] => {
  const out: string[] = [];
  for (let date = from; date <= to; date = addIsoDays(date, 1)) out.push(date);
  return out;
};

describe('LEARN-1 T3 — a hub date under the flag takes the hub cells as they are', () => {
  it('value → measured; null + estimate → backup, with the estimate as its value', () => {
    const result = periodAudience(
      input({
        hourly: [
          cell(TODAY, 18, 12),
          cell(TODAY, 19, 12),
          cell(TODAY, 20, null, 30),
          cell(TODAY, 21, null, 30),
        ],
      }),
    );
    expect(result.cells).toEqual([
      { date: TODAY, slot: 18, value: 12, source: 'measured' },
      { date: TODAY, slot: 19, value: 12, source: 'measured' },
      { date: TODAY, slot: 20, value: 30, source: 'backup' },
      { date: TODAY, slot: 21, value: 30, source: 'backup' },
    ]);
    // FLOW-4 — 9h = 12, 10h = 30, the day is 42; one backup hour makes it an estimation.
    expect(result.days).toEqual([
      { date: TODAY, audience: 42, source: 'estimated', hasMeasured: true },
    ]);
    expect(result.estimatedPct).toBe(71); // 30 / 42 — value-weighted, as before
  });

  it('a measured 0 is a 0 — even with a grid cell there and the device reported offline', () => {
    const result = periodAudience(
      input({
        hourly: [
          { date: TODAY, slot: 20, value: 0, deviceOnline: false },
          { date: TODAY, slot: 21, value: 0, deviceOnline: false },
        ],
        grid: gridWith([[MONDAY, 10, 500]]),
      }),
    );
    expect(result.cells).toEqual([
      { date: TODAY, slot: 20, value: 0, source: 'measured' },
      { date: TODAY, slot: 21, value: 0, source: 'measured' },
    ]);
    expect(result.days).toEqual([
      { date: TODAY, audience: 0, source: 'measured', hasMeasured: true },
    ]);
  });

  it('a slot outside the CURRENT hours is ignored — a measured value AND an estimate there', () => {
    // 08 → 22: 01h00 (slot 2) and 22h30 (slot 45) are closed; 21h30 (slot 43) is the last open one.
    const result = periodAudience(
      input({ hourly: [cell(TODAY, 2, 99), cell(TODAY, 45, null, 70), cell(TODAY, 43, 5)] }),
    );
    expect(result.cells).toEqual([{ date: TODAY, slot: 43, value: 5, source: 'measured' }]);
    expect(result.total).toBe(5);
  });

  it('null without estimate is not a data point — and the grid never fills it on a hub date', () => {
    const result = periodAudience(
      input({
        hourly: [cell(TODAY, 18, 12), cell(TODAY, 20, null), cell(TODAY, 21, null)],
        grid: gridWith([[MONDAY, 10, 500]]),
      }),
    );
    expect(result.cells).toEqual([{ date: TODAY, slot: 18, value: 12, source: 'measured' }]);
    expect(result.days).toEqual([
      { date: TODAY, audience: 12, source: 'measured', hasMeasured: true },
    ]);
  });

  it('a hub date holding only nulls is no day at all — never the grid, never monthly_stats', () => {
    const result = periodAudience(
      input({
        hourly: [cell(TODAY, 20, null), cell(TODAY, 21, null)],
        grid: gridWith([[MONDAY, 10, 500]]),
        months: [{ month: '2026-09', daily: [{ date: TODAY, audience: 900, source: 'measured' }] }],
      }),
    );
    expect(result.days).toEqual([]);
    expect(result.estimatedPct).toBeNull();
  });

  it("a legacy OFF-1 null row (device_online set) is not a hub cell — the date keeps today's path", () => {
    // Planner, from Surprise 5: the flagged hub rewrites every open row since the venue's first
    // reading WITHOUT device_online, so a null row still carrying it predates the flag — a date
    // before the first reading, or a venue never measured. It must not blank the typed grid.
    const result = periodAudience(
      input({
        hourly: [
          { date: TODAY, slot: 20, value: null, deviceOnline: false },
          { date: TODAY, slot: 21, value: null, deviceOnline: true },
        ],
        grid: gridWith([[MONDAY, 10, 500]]),
      }),
    );
    expect(result.cells).toEqual([
      { date: TODAY, slot: 20, value: 500, source: 'backup' },
      { date: TODAY, slot: 21, value: 500, source: 'backup' },
    ]);
  });

  it("a date whose ONLY rows are closed is not a hub date — it keeps today's path", () => {
    // A night row stored before the flag (the old pushes sent them); nothing open that day.
    const result = periodAudience(
      input({ hourly: [cell(TODAY, 2, 99)], grid: gridWith([[MONDAY, 10, 500]]) }),
    );
    expect(result.cells).toEqual([
      { date: TODAY, slot: 20, value: 500, source: 'backup' },
      { date: TODAY, slot: 21, value: 500, source: 'backup' },
    ]);
  });

  it('NULL hours = all 48 slots open (a venue with no declared hours)', () => {
    const result = periodAudience(
      input({
        learned: { openingHour: null, closingHour: null },
        hourly: [cell(TODAY, 2, 7), cell(TODAY, 45, null, 9)],
      }),
    );
    expect(result.cells).toEqual([
      { date: TODAY, slot: 2, value: 7, source: 'measured' },
      { date: TODAY, slot: 45, value: 9, source: 'backup' },
    ]);
  });

  it('an overnight window wraps: 08 → 01 keeps 00h30 and 08h00, drops 01h00 and 07h30', () => {
    const result = periodAudience(
      input({
        learned: { openingHour: 8, closingHour: 1 },
        hourly: [cell(TODAY, 1, 4), cell(TODAY, 2, 6), cell(TODAY, 15, 8), cell(TODAY, 16, 10)],
      }),
    );
    expect(result.cells.map((c) => c.slot)).toEqual([1, 16]);
  });

  it("dates with NO hub cell keep today's path: the monthly day total, else the grid from the floor", () => {
    const result = periodAudience(
      input({
        range: { from: '2026-09-13', to: '2026-09-15' }, // Sun (monthly) · Mon (hub) · Tue (grid)
        months: [
          {
            month: '2026-09',
            daily: [{ date: '2026-09-13', audience: 400, source: 'measured' }],
          },
        ],
        hourly: [cell('2026-09-14', 18, 12)],
        grid: gridWith([[2, 10, 50]]), // Tuesday 10h
        onboardedIso: '2026-09-01',
      }),
    );
    expect(result.days).toEqual([
      { date: '2026-09-13', audience: 400, source: 'measured', hasMeasured: true },
      { date: '2026-09-14', audience: 12, source: 'measured', hasMeasured: true },
      { date: '2026-09-15', audience: 50, source: 'estimated', hasMeasured: false },
    ]);
  });

  it('a monthly day total BEFORE the floor does not count under the flag (closed-hour readings only)', () => {
    const over = {
      range: { from: '2026-09-12', to: '2026-09-13' },
      months: [
        {
          month: '2026-09',
          daily: [
            { date: '2026-09-12', audience: 40, source: 'measured' as const }, // before the floor
            { date: '2026-09-13', audience: 400, source: 'measured' as const },
          ],
        },
      ],
      onboardedIso: '2026-09-13',
    };
    expect(periodAudience(input(over)).days).toEqual([
      { date: '2026-09-13', audience: 400, source: 'measured', hasMeasured: true },
    ]);
    // Flag off: measurement is never clamped — today's behaviour, both days.
    expect(periodAudience(input({ ...over, learned: null })).days.map((d) => d.date)).toEqual([
      '2026-09-12',
      '2026-09-13',
    ]);
  });

  it('S02 folds learned cells by the peak rule, provenance and all (PEAK-MAX1 untouched)', () => {
    const result = periodAudience(
      input({
        range: { from: '2026-09-14', to: TODAY }, // two Mondays
        hourly: [cell('2026-09-14', 20, null, 35), cell(TODAY, 20, 30)],
      }),
    );
    expect(weekGridFromCells(result.cells)[MONDAY - 1]![20]).toEqual({
      value: 35,
      source: 'backup',
    });
  });

  // LEARN-1 T3 fix round — pins of FLOW-4 (hour = mean of the halves present; a lone half is its
  // own hour), on hour 9h (slots 18/19), open under the default OPEN_8_22.

  it('a mixed hour: one measured half and one backup half average into the hour', () => {
    const result = periodAudience(
      input({ hourly: [cell(TODAY, 18, 10), cell(TODAY, 19, null, 30)] }),
    );
    // 9h = (10 + 30) / 2 = 20; one backup half makes the day an estimation.
    expect(result.days).toEqual([
      { date: TODAY, audience: 20, source: 'estimated', hasMeasured: true },
    ]);
    // 30 of the hour's 40 (10 + 30) comes from the estimate: 30 / 40 = 75 %.
    expect(result.estimatedPct).toBe(75);
  });

  it('a lone half, with no estimate on the other, is its own hour', () => {
    const result = periodAudience(input({ hourly: [cell(TODAY, 18, 10), cell(TODAY, 19, null)] }));
    // 19 carries no estimate, so it is not a data point; 9h is the lone half, 10, and measured.
    expect(result.days).toEqual([
      { date: TODAY, audience: 10, source: 'measured', hasMeasured: true },
    ]);
  });

  it('a learned zero is a real data point — (10 + 0) / 2 = 5, not a lone 10', () => {
    const result = periodAudience(
      input({ hourly: [cell(TODAY, 18, 10), cell(TODAY, 19, null, 0)] }),
    );
    expect(result.days).toEqual([
      { date: TODAY, audience: 5, source: 'estimated', hasMeasured: true },
    ]);
  });
});

describe('LEARN-1 T3 — flag OFF is today, byte for byte', () => {
  const HUB_DAY = '2026-09-14'; // a Monday
  const base: HourlyCell[] = [
    cell(HUB_DAY, 2, 99), // a night row stored before the flag
    cell(HUB_DAY, 18, 10),
    cell(HUB_DAY, 19, 10),
    cell(HUB_DAY, 20, null),
    cell(HUB_DAY, 21, null),
    { date: HUB_DAY, slot: 22, value: null, deviceOnline: false },
  ];
  const withEstimates: HourlyCell[] = base.map((c) =>
    c.slot === 20 || c.slot === 21 ? { ...c, estimate: 30 } : c,
  );
  const off = (hourly: HourlyCell[]) =>
    periodAudience(
      input({
        learned: null,
        range: { from: HUB_DAY, to: HUB_DAY },
        hourly,
        grid: gridWith([[MONDAY, 12, 500]]),
      }),
    );

  it("estimates and hours are invisible: the result equals the estimate-free input's", () => {
    expect(off(withEstimates)).toEqual(off(base));
  });

  it('pinned: the old merge — the night 99 counts, the grid fills 12h, the estimates do not exist', () => {
    const result = off(withEstimates);
    expect(result.cells).toEqual([
      { date: HUB_DAY, slot: 2, value: 99, source: 'measured' },
      { date: HUB_DAY, slot: 18, value: 10, source: 'measured' },
      { date: HUB_DAY, slot: 19, value: 10, source: 'measured' },
      { date: HUB_DAY, slot: 24, value: 500, source: 'backup' },
      { date: HUB_DAY, slot: 25, value: 500, source: 'backup' },
    ]);
    expect(result.total).toBe(609); // 1h 99 + 9h 10 + 12h 500
    expect(result.estimatedPct).toBe(82); // 500 / 609
  });
});

describe('LEARN-1 T3 — every « Mes performances » période, across the hub-cell edge', () => {
  // The venue: onboarded 01/05 (the grid may answer from there), June held as MEASURED day totals of
  // 100 (history older than the hub cells), first hub cell 01/07 — every date from then holds hub
  // cells: 9h measured 10 (both halves), 10h estimated 30 (both halves), a night row of 99 stored
  // before the flag (closed), 11h00 reported nothing. The grid says 500 at 12h every day.
  const HUB_FROM = '2026-07-01';
  const hubCells: HourlyCell[] = datesBetween(HUB_FROM, TODAY).flatMap((date) => [
    cell(date, 2, 99),
    cell(date, 18, 10),
    cell(date, 19, 10),
    cell(date, 20, null, 30),
    cell(date, 21, null, 30),
    cell(date, 22, null),
  ]);
  const june = {
    month: '2026-06',
    daily: datesBetween('2026-06-01', '2026-06-30').map((date) => ({
      date,
      audience: 100,
      source: 'measured' as const,
    })),
  };
  const noonEveryDay = gridWith(
    [1, 2, 3, 4, 5, 6, 7].map((day): [number, number, number] => [day, 12, 500]),
  );
  const run = (range: { from: string; to: string }) =>
    periodAudience(
      input({
        range,
        months: [june],
        hourly: hubCells,
        grid: noonEveryDay,
        onboardedIso: '2026-05-01',
      }),
    );

  // The pills as apps/web/src/features/screenhost/lib/performance-period.ts resolvePeriodRange
  // resolves them on TODAY (Mon 21/09/2026). A hub day is 40 (10 measured + 30 estimated), a June
  // day 100 (measured, day granularity), a May day 500 (the grid, from the floor).
  const CASES = [
    { period: '7d', range: { from: '2026-09-15', to: TODAY }, total: 280, days: 7, pct: 75 },
    { period: '28d', range: { from: '2026-08-25', to: TODAY }, total: 1120, days: 28, pct: 75 },
    { period: '3m', range: { from: '2026-06-21', to: TODAY }, total: 4320, days: 93, pct: 58 },
    { period: '12m', range: { from: '2025-09-21', to: TODAY }, total: 21820, days: 144, pct: 82 },
    { period: 'all', range: { from: '2020-01-01', to: TODAY }, total: 21820, days: 144, pct: 82 },
    {
      period: 'custom',
      range: { from: '2026-06-25', to: '2026-07-05' },
      total: 800,
      days: 11,
      pct: 19,
    },
  ];

  it.each(CASES)('$period: total $total over $days days, $pct % estimés', (c) => {
    const result = run(c.range);
    expect(result.total).toBe(c.total);
    expect(result.days).toHaveLength(c.days);
    expect(result.estimatedPct).toBe(c.pct);
    // No hub date ever carries the grid's 500 or the closed night row's 99.
    expect(result.cells.some((x) => x.date >= HUB_FROM && (x.value === 500 || x.slot === 2))).toBe(
      false,
    );
  });

  it('the edge itself: the last day without hub cells, then the first day with them', () => {
    expect(run({ from: '2026-06-30', to: '2026-07-01' }).days).toEqual([
      { date: '2026-06-30', audience: 100, source: 'measured', hasMeasured: true },
      { date: '2026-07-01', audience: 40, source: 'estimated', hasMeasured: true },
    ]);
  });
});
