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

/**
 * A backup grid with the given (isoDay 1=Mon..7, HOUR, value) cells FILLED by the admin.
 *
 * Slice C — the grid is 7×48 now, and an hour-shaped fixture fills BOTH of its halves with the
 * SAME value, exactly as the ingest does for an hour-shaped push. That is deliberate: every
 * assertion in this file keeps the number it always had, which IS the slice-C pin — on equal
 * halves nothing moves. The unequal cases are written explicitly, by slot.
 */
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

/** A backup grid keyed by SLOT — for the cases where the two halves differ on purpose. */
const gridWithSlots = (cells: [day: number, slot: number, value: number][]): BackupGrid => {
  const grid = emptyBackupGrid();
  for (const [day, slot, value] of cells) {
    grid.values[day - 1]![slot] = value;
    grid.has[day - 1]![slot] = true;
  }
  return grid;
};

/** Measured cells given per HOUR — both halves, same level (the level semantics). */
const hours = (date: string, pairs: [hour: number, value: number][]): HourlyCell[] =>
  pairs.flatMap(([hour, value]) => [
    { date, slot: hour * 2, value },
    { date, slot: hour * 2 + 1, value },
  ]);

/** Measured cells given per SLOT — for the deliberately unequal halves. */
const slots = (date: string, pairs: [slot: number, value: number][]): HourlyCell[] =>
  pairs.map(([slot, value]) => ({ date, slot, value }));

const input = (over: Partial<PeriodAudienceInput> = {}): PeriodAudienceInput => ({
  months: [],
  hourly: [],
  grid: emptyBackupGrid(),
  range: { from: TODAY, to: TODAY },
  todayIso: TODAY,
  // S02-FUT1 — 48 means « the whole day has elapsed », which is what every test written before the
  // ruling implicitly assumed. Keeping that here is what makes their numbers bit-identical; the
  // rule's own tests pass a real boundary.
  nowSlot: 48,
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
      { date: TODAY, slot: 18, value: 12, source: 'measured' },
      { date: TODAY, slot: 19, value: 12, source: 'measured' },
      { date: TODAY, slot: 20, value: 30, source: 'backup' },
      { date: TODAY, slot: 21, value: 30, source: 'backup' }, // not 0, and not « measured »
    ]);
  });

  it("S01's total carries the forced value — « rien ne s'est passé » is over", () => {
    expect(result.total).toBe(42); // 12 measured + 30 backup, NOT 12
    expect(result.days).toEqual([
      { date: TODAY, audience: 42, source: 'estimated', hasMeasured: true },
    ]);
    // One backup hour makes the DAY an estimation (AFF1's dayProvenance ruling), so it can never
    // become the « Pic d'audience » (MEJ-R1).
    expect(result.measuredDays).toBe(0);
  });

  it("S02's cell for that slot is the backup value, marked as an estimation", () => {
    const week = weekGridFromCells(result.cells);
    expect(week[MONDAY - 1]![20]).toEqual({ value: 30, source: 'backup' }); // 10h00
    expect(week[MONDAY - 1]![18]).toEqual({ value: 12, source: 'measured' }); // 9h00
  });

  // Slice C redefined this caption: it weights by VALUE, not by counting rows. Mejri's outage
  // hour is worth 30 against the measured hour's 12, so it is the LARGER part of that day's
  // audience even though it is one cell of two — 71 %, not the 50 % a row count would claim.
  it("the caption weights by VALUE: the outage hour is most of that day's audience → 71 %", () => {
    expect(result.estimatedPct).toBe(71); // 30 / (30 + 12), the 0.5 cancelling on both sides
  });
});

describe('AUD-HOURLY1-C — the four merge rules', () => {
  it('rule 1: a measured cell above zero wins over the grid', () => {
    const result = periodAudience(
      input({ hourly: hours(TODAY, [[9, 12]]), grid: gridWith([[MONDAY, 9, 999]]) }),
    );
    expect(result.cells).toEqual([
      { date: TODAY, slot: 18, value: 12, source: 'measured' },
      { date: TODAY, slot: 19, value: 12, source: 'measured' },
    ]);
  });

  it('rule 2: a measured ZERO defers to the grid cell when the admin filled one', () => {
    const result = periodAudience(
      input({ hourly: hours(TODAY, [[9, 0]]), grid: gridWith([[MONDAY, 9, 30]]) }),
    );
    expect(result.cells).toEqual([
      { date: TODAY, slot: 18, value: 30, source: 'backup' },
      { date: TODAY, slot: 19, value: 30, source: 'backup' },
    ]);
  });

  it('rule 2: a measured ZERO STANDS where the grid has no cell (outside opening hours)', () => {
    // An empty grid isolates the rule: 3h is not an opening hour by the hub's own definition
    // (« opening hours » = the cells the admin filled), so the zero is the honest answer.
    const result = periodAudience(
      input({ hourly: hours(TODAY, [[3, 0]]), grid: emptyBackupGrid() }),
    );
    expect(result.cells).toEqual([
      { date: TODAY, slot: 6, value: 0, source: 'measured' },
      { date: TODAY, slot: 7, value: 0, source: 'measured' },
    ]);
    expect(result.days).toEqual([
      { date: TODAY, audience: 0, source: 'measured', hasMeasured: true },
    ]);
  });

  it('rules 2 and 3 together: the dark hour stands at 0, a never-measured open hour is filled', () => {
    const result = periodAudience(
      input({ hourly: hours(TODAY, [[3, 0]]), grid: gridWith([[MONDAY, 9, 30]]) }),
    );
    expect(result.cells).toEqual([
      { date: TODAY, slot: 6, value: 0, source: 'measured' },
      { date: TODAY, slot: 7, value: 0, source: 'measured' }, // closed hour, zero stands
      { date: TODAY, slot: 18, value: 30, source: 'backup' },
      { date: TODAY, slot: 19, value: 30, source: 'backup' }, // open hour with no measure, filled
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
      { date: TODAY, slot: 18, value: 5, source: 'measured' }, // 9h00
      { date: TODAY, slot: 19, value: 5, source: 'measured' }, // 9h30
      { date: TODAY, slot: 22, value: 40, source: 'backup' }, // 11h00
      { date: TODAY, slot: 23, value: 40, source: 'backup' }, // 11h30
    ]);
    // 10h has no measure and no grid cell → absent in BOTH halves, so it cannot drag the
    // averages down.
    expect(result.cells.some((c) => c.slot === 20 || c.slot === 21)).toBe(false);
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
      { date: '2026-08-24', slot: 18, value: 7, source: 'measured' },
      { date: '2026-08-24', slot: 19, value: 7, source: 'measured' },
      // …while the post-floor measured zero may defer to the grid.
      { date: TODAY, slot: 18, value: 30, source: 'backup' },
      { date: TODAY, slot: 19, value: 30, source: 'backup' },
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
    expect(result.cells).toEqual([
      { date: '2026-08-24', slot: 18, value: 0, source: 'measured' },
      { date: '2026-08-24', slot: 19, value: 0, source: 'measured' },
    ]);
  });

  it('rule 4: the backup grid alone never answers for days before the floor', () => {
    const result = periodAudience(
      input({
        range: { from: '2026-08-17', to: TODAY }, // three Mondays: 17, 24, 31
        grid: gridWith([[MONDAY, 9, 30]]),
        onboardedIso: '2026-08-26',
      }),
    );
    expect(result.days).toEqual([
      { date: TODAY, audience: 30, source: 'estimated', hasMeasured: false },
    ]);
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
    expect(result.days).toEqual([
      { date: TODAY, audience: 12, source: 'measured', hasMeasured: true },
    ]);
  });

  it('history older than the window still reads from monthly_stats, at DAY granularity', () => {
    const result = periodAudience(
      input({
        range: { from: '2026-07-27', to: '2026-07-27' }, // a Monday, outside the hourly window
        months,
        grid: gridWith([[MONDAY, 9, 30]]),
      }),
    );
    expect(result.days).toEqual([
      { date: '2026-07-27', audience: 400, source: 'measured', hasMeasured: true },
    ]);
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

// MEJ-R2 (architect 2026-09-01) — every day carries whether it holds AT LEAST ONE measured cell.
// `source` answers the stricter "is EVERY cell measured"; both are needed and they differ exactly
// on the mixed day that started this ticket.
describe('periodAudience — hasMeasured, the peak-eligibility flag', () => {
  it('a MIXED day is source:estimated but hasMeasured:true (Mejri 31/08)', () => {
    const result = periodAudience(
      input({
        hourly: hours(TODAY, [
          [9, 373],
          [10, 0], // the outage hour, forced from the grid
        ]),
        grid: gridWith([[MONDAY, 10, 30]]),
      }),
    );
    expect(result.days).toEqual([
      { date: TODAY, audience: 403, source: 'estimated', hasMeasured: true },
    ]);
  });

  it('a grid-ONLY day is hasMeasured:false — never eligible for the peak', () => {
    const result = periodAudience(input({ grid: gridWith([[MONDAY, 9, 1396]]) }));
    expect(result.days).toEqual([
      { date: TODAY, audience: 1396, source: 'estimated', hasMeasured: false },
    ]);
  });

  it('day-granularity measured history is hasMeasured:true', () => {
    const result = periodAudience(
      input({
        range: { from: '2026-07-27', to: '2026-07-27' }, // a Monday outside the hourly window
        months: [
          { month: '2026-07', daily: [{ date: '2026-07-27', audience: 400, source: 'measured' }] },
        ],
        grid: gridWith([[MONDAY, 9, 30]]),
      }),
    );
    expect(result.days).toEqual([
      { date: '2026-07-27', audience: 400, source: 'measured', hasMeasured: true },
    ]);
  });

  it('an all-measured day is both source:measured and hasMeasured:true', () => {
    const result = periodAudience(input({ hourly: hours(TODAY, [[9, 12]]) }));
    expect(result.days).toEqual([
      { date: TODAY, audience: 12, source: 'measured', hasMeasured: true },
    ]);
  });
});

// ── Slice C — the half-hour merge ────────────────────────────────────────────────────────────
//
// Every assertion ABOVE is the slice-C pin: the fixtures write both halves of each hour, which is
// what an hour-shaped push produces, and not one number moved. These are the cases that only exist
// once the halves can differ.
describe('slice C — duration-weighted sums and unequal halves', () => {
  it('THE INVARIANT: equal halves give exactly the old day total, not double it', () => {
    // 24 hours at 100 → the day is Σ (100 × 0.5) over 48 slots = 2400, which is Σ 100 over 24
    // hours. Summing 48 cells unweighted would say 4800 — the silent doubling this guards.
    const everyHour: [number, number][] = Array.from({ length: 24 }, (_, h) => [h, 100]);
    const result = periodAudience(input({ hourly: hours(TODAY, everyHour) }));
    expect(result.days[0]?.audience).toBe(2400);
    expect(result.total).toBe(2400);
    expect(result.cells).toHaveLength(48); // stored per half…
    expect(result.days[0]?.audience).not.toBe(4800); // …but never counted twice
  });

  it('MEJ-8: a half-hour outage now MOVES the day total, and in the expected direction', () => {
    // 9h00 measured at 200; 9h30 the sensor went dark and the admin's grid says 40. Before the
    // half-hour grid the hour bucket was carried by its surviving reading and the outage was
    // INVISIBLE. Now it costs the day exactly the half-hour it lost.
    const result = periodAudience(
      input({
        hourly: slots(TODAY, [[18, 200]]),
        grid: gridWithSlots([[MONDAY, 19, 40]]),
      }),
    );
    expect(result.days[0]?.audience).toBe(120); // 200×0.5 + 40×0.5
    expect(result.days[0]?.audience).toBeLessThan(200); // the outage is visible, not absorbed
    // …and the day is an estimation now, because one of its halves is the admin's grid.
    expect(result.days[0]?.source).toBe('estimated');
    expect(result.days[0]?.hasMeasured).toBe(true); // but still peak-eligible (MEJ-R2)
  });

  it('a lone measured half stands alone — the missing half is not invented as a zero', () => {
    const result = periodAudience(input({ hourly: slots(TODAY, [[18, 200]]) }));
    expect(result.cells).toHaveLength(1);
    expect(result.days[0]?.audience).toBe(100); // 200 × 0.5, for the half hour it actually covers
    expect(result.days[0]?.source).toBe('measured');
  });

  it('the day total rounds to whole people, and only ever on unequal halves', () => {
    // 9h00 = 100, 9h30 = 101 → 100.5 → 101. Equal halves can never need this (their sum is the
    // old integer exactly), so rounding cannot perturb an existing number.
    const odd = periodAudience(
      input({
        hourly: slots(TODAY, [
          [18, 100],
          [19, 101],
        ]),
      }),
    );
    expect(odd.days[0]?.audience).toBe(101);
    const even = periodAudience(input({ hourly: hours(TODAY, [[9, 100]]) }));
    expect(even.days[0]?.audience).toBe(100);
  });

  // ACCEPTED, not discovered later (planner ruling): Math.round sends TIES UP, and a tie happens
  // whenever a day's weighted slot sum is odd — so on unequal halves the day total runs high by at
  // most +0.5, ≈ +0.25 on average, against totals in the hundreds. That is below the precision the
  // estimate carries anyway; banker's rounding and a fractional wire both cost more than they buy.
  // This assertion exists so the bias has a NAME when someone notices « the totals run slightly
  // high » and goes looking.
  it('ACCEPTED BIAS: an odd weighted sum rounds UP, never to even and never truncated', () => {
    // 9h00 = 100, 9h30 = 101 → 100.5. Half-up gives 101; banker's rounding would give 100.
    const odd = periodAudience(
      input({
        hourly: slots(TODAY, [
          [18, 100],
          [19, 101],
        ]),
      }),
    );
    expect(odd.days[0]?.audience).toBe(101);
    // …and the same shape one lower, to show it is the .5 that rounds up, not a floor/ceil.
    const evenSum = periodAudience(
      input({
        hourly: slots(TODAY, [
          [18, 100],
          [19, 102],
        ]),
      }),
    );
    expect(evenSum.days[0]?.audience).toBe(101); // 101.0 exactly
  });

  // Slice C, ruled 2026-09-01 — « dont N % estimés » is VALUE-WEIGHTED:
  //     Σ (estimated audience) / Σ (all audience)
  // and is the ONE quantity exempt from the equal-halves bit-identical pin, because it is a
  // definition change rather than a granularity change.
  describe('estimatedPct — the share of PEOPLE, not of rows', () => {
    it('a half-estimated hour weights by its VALUE, not by counting one row of two', () => {
      const result = periodAudience(
        input({
          hourly: slots(TODAY, [[18, 200]]),
          grid: gridWithSlots([[MONDAY, 19, 40]]),
        }),
      );
      expect(result.cells).toHaveLength(2);
      // 40 estimated against 240 total (both halves × 0.5 cancels) → 17 %, not the 50 % that
      // counting rows would have claimed for a half-hour worth a sixth of the audience.
      expect(result.estimatedPct).toBe(17);
    });

    it('THE REALISTIC SHAPE: 27 measured history days + one half-estimated day of slots', () => {
      // The case that condemned the point share: it would read ≈ 32 % estimés (24 backup slots
      // out of 27 + 48 points) on a venue that measured 27 days straight. The truth is the
      // estimated PEOPLE, which is a rounding error beside a month of measured history.
      const from = '2026-08-04'; // a Monday, 27 days before TODAY
      const daily = Array.from({ length: 27 }, (_, i) => {
        const day = String(4 + i).padStart(2, '0');
        return { date: `2026-08-${day}`, audience: 1000, source: 'measured' as const };
      });
      const result = periodAudience(
        input({
          range: { from, to: TODAY },
          months: [{ month: '2026-08', daily }],
          // The last day only: 12 measured hours, and 12 hours the admin's grid stands in for.
          hourly: hours(
            TODAY,
            Array.from({ length: 12 }, (_, h) => [h + 8, 100]),
          ),
          grid: gridWith(Array.from({ length: 12 }, (_, h) => [MONDAY, h + 20, 50])),
        }),
      );
      expect(result.measuredDays).toBe(27);
      expect(result.estimatedPct).not.toBeNull();
      // 600 estimated people-hours against 27 000 + 1 800 → 2 %, not 32 %.
      expect(result.estimatedPct!).toBeLessThan(5);
    });

    it('null still means NO DATA AT ALL — the meaning the PDF branches on', () => {
      expect(periodAudience(input({})).estimatedPct).toBeNull();
    });

    it('a période holding data but ZERO audience falls back to the point share, never to null', () => {
      // Degenerate: the sensor counted nobody all period. There is no audience to apportion, but
      // there IS data — so null (which means « no data ») would mislead the surfaces that branch
      // on it, and the point share is the only defined answer left.
      const result = periodAudience(input({ hourly: hours(TODAY, [[9, 0]]) }));
      expect(result.cells).toHaveLength(2);
      expect(result.estimatedPct).toBe(0); // measured zeros — nothing estimated
    });
  });
});

// ── S02-FUT1 (Mejri, ruled 2026-09-02) — RULE 5: no backup for a slot that has not happened ──
//
// « J'ai programmé manuellement dans le Hub : 50 entre 13h00 et 13h30, 56 entre 13h30 et 14h00. Le
// capteur est actuellement en ligne et l'heure de 13h00 n'est pas encore arrivée. Pourtant, ces
// valeurs apparaissent déjà dans Peak Hours. Les données forcées ne devraient être prises en
// compte que lorsque le capteur est offline. »
//
// A slot is « offline » once it has ELAPSED without a reading. Before then nothing has failed, so
// there is nothing for the grid to stand in for.
describe('S02-FUT1 — the grid may not answer for a slot that has not elapsed', () => {
  // TODAY is a Monday; 12h50 Tunis is slot 25, so 13h00 (26) and 13h30 (27) are still ahead.
  const NOW_1250 = 25;

  it('HER CASE: the sensor is online at 12h50 and 13h00/13h30 show NOTHING today', () => {
    const result = periodAudience(
      input({
        nowSlot: NOW_1250,
        grid: gridWithSlots([
          [MONDAY, 26, 50], // 13h00–13h30, typed into the hub
          [MONDAY, 27, 56], // 13h30–14h00
        ]),
      }),
    );
    // Not a backup cell, not a zero — not a data point at all.
    expect(result.cells).toEqual([]);
    expect(result.days).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.estimatedPct).toBeNull();
  });

  it('the SAME grid cells DO answer for a past day in the période — 01/09 is not lost', () => {
    // The missed-report visibility she asked for the day before: a PAST slot with no reading
    // still falls back to the admin's grid. Only « not yet » is excluded.
    const result = periodAudience(
      input({
        nowSlot: NOW_1250,
        range: { from: '2026-08-24', to: TODAY }, // 24/08 is a Monday, a week earlier
        grid: gridWithSlots([
          [MONDAY, 26, 50],
          [MONDAY, 27, 56],
        ]),
      }),
    );
    expect(result.cells).toEqual([
      { date: '2026-08-24', slot: 26, value: 50, source: 'backup' },
      { date: '2026-08-24', slot: 27, value: 56, source: 'backup' },
    ]);
    expect(result.days.map((d) => d.date)).toEqual(['2026-08-24']); // today contributes nothing
    expect(result.days[0]?.audience).toBe(53); // (50 + 56) × 0.5
  });

  it('the IN-PROGRESS slot is not elapsed either — the E6 boundary, at slot granularity', () => {
    // 12h50 sits inside slot 25. It has not finished, so the sensor has not yet failed to report.
    const during = periodAudience(
      input({ nowSlot: NOW_1250, grid: gridWithSlots([[MONDAY, 25, 40]]) }),
    );
    expect(during.cells).toEqual([]);
    // …and the moment it HAS elapsed (now = 13h00, slot 26), the grid answers for it.
    const after = periodAudience(input({ nowSlot: 26, grid: gridWithSlots([[MONDAY, 25, 40]]) }));
    expect(after.cells).toEqual([{ date: TODAY, slot: 25, value: 40, source: 'backup' }]);
  });

  it('a MEASURED reading is never suppressed — the rule bounds BACKUP only', () => {
    // If the sensor did report inside the current slot, that is observed data, not a stand-in.
    const result = periodAudience(
      input({
        nowSlot: NOW_1250,
        hourly: slots(TODAY, [[25, 90]]),
        grid: gridWithSlots([[MONDAY, 25, 40]]),
      }),
    );
    expect(result.cells).toEqual([{ date: TODAY, slot: 25, value: 90, source: 'measured' }]);
  });

  it("today's day total and « dont N % estimés » shrink accordingly — correct, not a regression", () => {
    const result = periodAudience(
      input({
        nowSlot: NOW_1250,
        // 8h00–12h00 elapsed and estimated; 13h00 onwards typed but still ahead.
        grid: gridWithSlots([
          ...Array.from({ length: 8 }, (_, i): [number, number, number] => [MONDAY, 16 + i, 10]),
          [MONDAY, 26, 50],
          [MONDAY, 27, 56],
        ]),
      }),
    );
    expect(result.cells).toHaveLength(8); // only the elapsed ones
    expect(result.days[0]?.audience).toBe(40); // 8 × 10 × 0.5 — the future 106 is not counted
    expect(result.estimatedPct).toBe(100); // everything it DOES hold is estimated
  });

  it('the DAY-GRANULARITY history path is untouched by the rule', () => {
    // A measured day from monthly_stats has no slots to be « not yet » about.
    const result = periodAudience(
      input({
        nowSlot: 0, // the very start of the day: every slot is still ahead
        months: [{ month: '2026-08', daily: [{ date: TODAY, audience: 700, source: 'measured' }] }],
      }),
    );
    expect(result.days).toEqual([
      { date: TODAY, audience: 700, source: 'measured', hasMeasured: true },
    ]);
  });
});

describe('weekGridFromCells — S02 is the période folded into a weekday × slot grid', () => {
  it('averages the cells that fall on a slot and rounds', () => {
    const week = weekGridFromCells([
      { date: '2026-08-24', slot: 18, value: 10, source: 'measured' }, // Monday
      { date: TODAY, slot: 18, value: 15, source: 'measured' }, // Monday
    ]);
    expect(week[MONDAY - 1]![18]).toEqual({ value: 13, source: 'measured' }); // 12.5 → 13
  });

  it('one backup cell makes the whole slot an estimation (the AFF1 ruling)', () => {
    const week = weekGridFromCells([
      { date: '2026-08-24', slot: 18, value: 10, source: 'measured' },
      { date: TODAY, slot: 18, value: 30, source: 'backup' },
    ]);
    expect(week[MONDAY - 1]![18]).toEqual({ value: 20, source: 'backup' });
  });

  it('a slot the période holds no cell for is null — hachured, never a coloured 0', () => {
    const week = weekGridFromCells([{ date: TODAY, slot: 18, value: 10, source: 'measured' }]);
    expect(week[MONDAY - 1]![20]).toEqual({ value: null, source: null }); // 10h00
    expect(week[MONDAY - 1]![19]).toEqual({ value: null, source: null }); // the OTHER half of 9h
    expect(week[TUESDAY - 1]![18]).toEqual({ value: null, source: null });
  });

  it('an empty période yields an all-null grid, not zeros', () => {
    const week = weekGridFromCells([]);
    expect(week).toHaveLength(7);
    expect(week.every((row) => row.every((c) => c.value === null && c.source === null))).toBe(true);
  });
});
