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
    expect(result.total).toBe(84); // (12 + 12) measured + (30 + 30) backup — FLOW-1 sums cells
    expect(result.days).toEqual([
      { date: TODAY, audience: 84, source: 'estimated', hasMeasured: true },
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
      { date: TODAY, audience: 60, source: 'estimated', hasMeasured: false }, // 30 per half
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
    // 24, not 912 and not 900 — the hourly window owns this date (12 in each half of 9h).
    expect(result.total).toBe(24);
    expect(result.days).toEqual([
      { date: TODAY, audience: 24, source: 'measured', hasMeasured: true },
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

  // FLOW-1 — the two paths into a day's audience must now AGREE. The hub's monthly-stats push is
  // SUM(total_count) for the day; the slot path was Σ (v × 0.5) and therefore said HALF of it. This
  // is the disagreement Mejri reported as « 274 personnes … contre 137 » and the reason the slot
  // path was the odd one out. Same day, same people, expressed both ways.
  //
  // ⚠️ THIS IS A FIXTURE, not evidence about prod: the halves below are hand-written to differ, the
  // way a real per-slot sensor push does. It pins the ARITHMETIC of the two paths, not the shape of
  // any stored data.
  it('FLOW-1: the slot path and the monthly-stats path give the SAME day total', () => {
    const HALVES: [number, number][] = [
      [18, 40], // 9h00
      [19, 35], // 9h30 — a real per-slot push rarely ties
      [20, 62], // 10h00
      [21, 55], // 10h30
    ];
    const dayTotal = HALVES.reduce((sum, [, v]) => sum + v, 0); // 192

    const fromSlots = periodAudience(input({ hourly: slots(TODAY, HALVES) }));
    expect(fromSlots.days[0]?.audience).toBe(dayTotal);

    // The same day arriving as the hub's day-granularity total, outside the hourly window.
    const fromMonthly = periodAudience(
      input({
        range: { from: '2026-07-27', to: '2026-07-27' },
        months: [{ month: '2026-07', daily: [{ date: '2026-07-27', audience: dayTotal }] }],
      }),
    );
    expect(fromMonthly.days[0]?.audience).toBe(dayTotal);
    expect(fromSlots.days[0]?.audience).toBe(fromMonthly.days[0]?.audience);
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
      { date: TODAY, audience: 806, source: 'estimated', hasMeasured: true }, // (373 + 373) + (30 + 30)
    ]);
  });

  it('a grid-ONLY day is hasMeasured:false — never eligible for the peak', () => {
    const result = periodAudience(input({ grid: gridWith([[MONDAY, 9, 1396]]) }));
    expect(result.days).toEqual([
      { date: TODAY, audience: 2792, source: 'estimated', hasMeasured: false }, // 1396 per half
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
      { date: TODAY, audience: 24, source: 'measured', hasMeasured: true }, // 12 per half
    ]);
  });
});

// ── Slice C — the half-hour merge ────────────────────────────────────────────────────────────
//
// Every assertion ABOVE is the slice-C pin: the fixtures write both halves of each hour, which is
// what an hour-shaped push produces, and not one number moved. These are the cases that only exist
// once the halves can differ.
// FLOW-1 (Mejri, ruled 2026-09-04) — a day's audience is the plain SUM of its half-hour cells.
// This block previously pinned slice C's duration weighting (Σ v × 0.5) and its rounding, both of
// which were the architect's « a cell is a LEVEL » invariant. She overruled it: « la somme dans le
// Hub et Peak Hours est de 274 personnes, contre 137 personnes pour les variables mentionnées » —
// exactly the factor 2 this weighting introduced. The tests are rewritten, not kept alongside; the
// old « THE INVARIANT: … not double it » test was guarding precisely what she asked for.
describe('FLOW-1 — a day is the SUM of its cells', () => {
  it('24 hours at 100 sum to 4800 across the 48 stored halves', () => {
    // The weighted rule gave 2400 here, treating 100 as a level held for half an hour. Under the
    // sum each cell is its own count, so the day is what the sensor counted in all 48 slots.
    const everyHour: [number, number][] = Array.from({ length: 24 }, (_, h) => [h, 100]);
    const result = periodAudience(input({ hourly: hours(TODAY, everyHour) }));
    expect(result.cells).toHaveLength(48);
    expect(result.days[0]?.audience).toBe(4800);
    expect(result.total).toBe(4800);
  });

  it('MEJ-8: a half-hour outage still MOVES the day total, in the expected direction', () => {
    // 9h00 measured at 200; 9h30 the sensor went dark and the admin's grid says 40. Before the
    // half-hour grid the hour bucket was carried by its surviving reading and the outage was
    // INVISIBLE. It still costs the day the half-hour it lost — now as a plain sum.
    const result = periodAudience(
      input({
        hourly: slots(TODAY, [[18, 200]]),
        grid: gridWithSlots([[MONDAY, 19, 40]]),
      }),
    );
    expect(result.days[0]?.audience).toBe(240); // 200 + 40
    // The outage is still visible: a measured 9h30 near 200 would have given ~400, not 240.
    expect(result.days[0]?.audience).toBeLessThan(400);
    expect(result.days[0]?.source).toBe('estimated');
    expect(result.days[0]?.hasMeasured).toBe(true); // still peak-eligible (MEJ-R2)
  });

  it('a lone measured half stands alone — the missing half is not invented as a zero', () => {
    const result = periodAudience(input({ hourly: slots(TODAY, [[18, 200]]) }));
    expect(result.cells).toHaveLength(1);
    expect(result.days[0]?.audience).toBe(200); // what that half-hour counted, verbatim
    expect(result.days[0]?.source).toBe('measured');
  });

  it('integers in, integer out — there is nothing left to round', () => {
    // 100 + 101 = 201. The weighted rule produced 100.5 here and had to round, which is where the
    // « ACCEPTED BIAS: an odd weighted sum rounds UP » ruling came from. Both are now moot: a sum
    // of integers is an integer, so no tie can arise and no bias can accumulate.
    const odd = periodAudience(
      input({
        hourly: slots(TODAY, [
          [18, 100],
          [19, 101],
        ]),
      }),
    );
    expect(odd.days[0]?.audience).toBe(201);
    expect(Number.isInteger(odd.days[0]?.audience)).toBe(true);

    const even = periodAudience(input({ hourly: hours(TODAY, [[9, 100]]) }));
    expect(even.days[0]?.audience).toBe(200); // both halves of 9h, each its own count
  });

  // Her 02/09 case, restated at the new rule: measured 7 + 15 + 5 + 10 across 12h–14h30 with the
  // admin's grid answering 13h30 at 56. The day was 47 under the weighting and is 93 now, while
  // « dont N % estimés » is unmoved — the 0.5 divided out of both sides of that ratio.
  it("Mejri's 02/09 day is 93, and « dont N % estimés » stays 60 %", () => {
    const result = periodAudience(
      input({
        hourly: slots(TODAY, [
          [24, 7],
          [25, 15],
          [26, 5],
          [29, 10],
        ]),
        grid: gridWithSlots([[MONDAY, 27, 56]]),
      }),
    );
    expect(result.days[0]?.audience).toBe(93); // 7 + 15 + 5 + 56 + 10
    expect(result.estimatedPct).toBe(60); // 56 / 93
  });
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
    expect(result.days[0]?.audience).toBe(106); // 50 + 56 — FLOW-1 sums, no weighting
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
    expect(result.days[0]?.audience).toBe(80); // 8 × 10 — the future 106 is not counted
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

// ── OFF-1 (Mejri, ruled 2026-09-02) — the manual grid applies ONLY while the sensor is OFF ──
//
// « Vérifier qu'elles ne soient pas prises en compte tant que le capteur est actif et continue
// d'envoyer des données. » The grid stands in for a FAILURE; while the sensor is up there is
// nothing to stand in for. Supersedes the 26/08 « backup where measured is 0 » reading.
describe('OFF-1 — device_online gates the backup', () => {
  const MONDAY_SLOT = 26; // 13h00

  /** A cell the hub sends for a slot it has an opinion about. */
  const cellAt = (slot: number, value: number | null, deviceOnline?: boolean) => ({
    date: TODAY,
    slot,
    value,
    ...(deviceOnline === undefined ? {} : { deviceOnline }),
  });

  it('HER CASE: sensor ONLINE, one empty slot, grid 56 → not a data point at all', () => {
    const result = periodAudience(
      input({
        hourly: [cellAt(MONDAY_SLOT, null, true)],
        grid: gridWithSlots([[MONDAY, MONDAY_SLOT, 56]]),
      }),
    );
    expect(result.cells).toEqual([]); // no measure, no backup — nothing has failed
    expect(result.total).toBe(0);
  });

  it('a GENUINE outage — the hub says offline — still falls back to the grid', () => {
    const result = periodAudience(
      input({
        hourly: [cellAt(MONDAY_SLOT, null, false)],
        grid: gridWithSlots([[MONDAY, MONDAY_SLOT, 56]]),
      }),
    );
    expect(result.cells).toEqual([{ date: TODAY, slot: MONDAY_SLOT, value: 56, source: 'backup' }]);
  });

  it('a measured ZERO from an ONLINE device is a REAL zero, not a backup trigger', () => {
    const online = periodAudience(
      input({
        hourly: [cellAt(MONDAY_SLOT, 0, true)],
        grid: gridWithSlots([[MONDAY, MONDAY_SLOT, 56]]),
      }),
    );
    expect(online.cells).toEqual([
      { date: TODAY, slot: MONDAY_SLOT, value: 0, source: 'measured' },
    ]);
    // …and the same zero from an OFFLINE device still defers to the grid (the 26/08 behaviour).
    const offline = periodAudience(
      input({
        hourly: [cellAt(MONDAY_SLOT, 0, false)],
        grid: gridWithSlots([[MONDAY, MONDAY_SLOT, 56]]),
      }),
    );
    expect(offline.cells).toEqual([
      { date: TODAY, slot: MONDAY_SLOT, value: 56, source: 'backup' },
    ]);
  });

  it('a measured VALUE always wins, online or not — the gate bounds the BACKUP only', () => {
    for (const online of [true, false, undefined]) {
      const result = periodAudience(
        input({
          hourly: [cellAt(MONDAY_SLOT, 90, online)],
          grid: gridWithSlots([[MONDAY, MONDAY_SLOT, 56]]),
        }),
      );
      expect(`online=${String(online)} → ${JSON.stringify(result.cells)}`).toBe(
        `online=${String(online)} → ${JSON.stringify([
          { date: TODAY, slot: MONDAY_SLOT, value: 90, source: 'measured' },
        ])}`,
      );
    }
  });

  it('THE INERT CASE: the flag ABSENT behaves exactly as before the ruling', () => {
    // This is what makes toodooh deployable BEFORE the hub sends anything.
    const noFlag = periodAudience(
      input({
        hourly: [cellAt(MONDAY_SLOT, null)],
        grid: gridWithSlots([[MONDAY, MONDAY_SLOT, 56]]),
      }),
    );
    const noCellAtAll = periodAudience(input({ grid: gridWithSlots([[MONDAY, MONDAY_SLOT, 56]]) }));
    expect(noFlag.cells).toEqual([{ date: TODAY, slot: MONDAY_SLOT, value: 56, source: 'backup' }]);
    expect(noFlag.cells).toEqual(noCellAtAll.cells); // indistinguishable, as ruled
  });
});

// PEAK-MAX1 acceptance — S02's rule must not leak into any other figure. S01, the day totals, the
// hero series and estimated_pct all read `merged.cells` / `merged.days`, never the week grid, and
// this is the test that says so rather than hoping it. The fixture is chosen so the MEAN and the
// MAX differ on every slot: if a day total ever started following the grid, these numbers move.
describe('PEAK-MAX1 — the peak rule stays inside S02', () => {
  // Every date is ELAPSED (<= todayIso): S02-FUT1 makes a slot a data point only once it has been,
  // so a Tuesday after TODAY would simply be absent and would prove nothing here.
  const TUESDAY_ISO = '2026-08-25';
  const twoWeeks = input({
    range: { from: '2026-08-24', to: TODAY },
    hourly: [
      ...slots('2026-08-24', [[18, 10]]), // Monday, quiet
      ...slots(TODAY, [[18, 40]]), // Monday a week later, the peak
      ...slots(TUESDAY_ISO, [[18, 20]]), // Tuesday
    ],
  });

  it("the day totals are the DAY's own cells — never the peak, never the mean", () => {
    const merged = periodAudience(twoWeeks);
    const byDate = new Map(merged.days.map((d) => [d.date, d.audience]));
    // FLOW-1 — one half-hour slot at value v contributes exactly v.
    expect(byDate.get('2026-08-24')).toBe(10);
    expect(byDate.get(TODAY)).toBe(40);
    expect(byDate.get(TUESDAY_ISO)).toBe(20);
    // The peak (40) is NOT the quiet Monday's total, which is the leak this pins against.
    expect(byDate.get('2026-08-24')).not.toBe(40);
  });

  it('the total and estimated_pct read the cells, and the grid reads the peak, independently', () => {
    const merged = periodAudience(twoWeeks);
    expect(merged.total).toBe(70); // 10 + 40 + 20 — the sum of the DAYS
    expect(merged.estimatedPct).toBe(0); // every cell measured
    // The same merge, folded: Monday's slot 18 shows its PEAK, not the 25 a mean would give.
    const week = weekGridFromCells(merged.cells);
    expect(week[MONDAY - 1]![18]).toEqual({ value: 40, source: 'measured' });
    expect(week[TUESDAY - 1]![18]).toEqual({ value: 20, source: 'measured' });
    // And the grid's peak is NOT the total: two quantities, two rules.
    expect(week[MONDAY - 1]![18]!.value).not.toBe(merged.total);
  });
});

// PEAK-MAX1 (Mejri, confirmed by the operator 2026-09-04) — S02 shows the PEAK on each slot, not
// the mean. « Peak means the highest value ever recorded at a specific thirty-minute slot … it will
// be the same for months after unless there is another thirty-minute slot that had a reading higher
// than the peak last recorded. » These tests previously pinned the MEAN (12.5 → 13) and the AFF1
// « one backup cell makes the whole slot an estimation » rule; both were correct for a mean and are
// wrong for a max, so they are rewritten rather than kept alongside.
describe('weekGridFromCells — S02 is the période folded into a weekday × slot grid', () => {
  it('takes the HIGHEST value on the slot, not the mean', () => {
    const week = weekGridFromCells([
      { date: '2026-08-24', slot: 18, value: 10, source: 'measured' }, // Monday
      { date: TODAY, slot: 18, value: 15, source: 'measured' }, // Monday
    ]);
    // The mean rule said 13 here (12.5 rounded). The peak is 15, and it is a real reading.
    expect(week[MONDAY - 1]![18]).toEqual({ value: 15, source: 'measured' });
  });

  // Her persistence property, stated as a rule rather than as an example: a later, quieter week
  // never lowers a cell; only a higher reading raises it. Order of arrival must not matter.
  it('a LATER, LOWER week never lowers the cell; a higher one raises it', () => {
    const rising = weekGridFromCells([
      { date: '2026-08-17', slot: 18, value: 40, source: 'measured' },
      { date: '2026-08-24', slot: 18, value: 12, source: 'measured' }, // quieter week, later
      { date: TODAY, slot: 18, value: 9, source: 'measured' }, // quieter still
    ]);
    expect(rising[MONDAY - 1]![18]).toEqual({ value: 40, source: 'measured' });

    const overtaken = weekGridFromCells([
      { date: '2026-08-17', slot: 18, value: 40, source: 'measured' },
      { date: TODAY, slot: 18, value: 41, source: 'measured' }, // one higher reading is enough
    ]);
    expect(overtaken[MONDAY - 1]![18]).toEqual({ value: 41, source: 'measured' });
  });

  // The provenance is the HOLDER's, not the group's. Under the old mean rule the first case read
  // { 20, backup }: an average containing an estimate is partly estimated. Under a max the number
  // shown IS one cell's, so a sensor reading is never disclosed as an estimation because some other
  // week's backup cell sat lower on the same slot.
  it('provenance follows the cell that HOLDS the max, either way round', () => {
    const backupWins = weekGridFromCells([
      { date: '2026-08-24', slot: 18, value: 10, source: 'measured' },
      { date: TODAY, slot: 18, value: 30, source: 'backup' },
    ]);
    expect(backupWins[MONDAY - 1]![18]).toEqual({ value: 30, source: 'backup' });

    const measuredWins = weekGridFromCells([
      { date: '2026-08-24', slot: 18, value: 30, source: 'measured' },
      { date: TODAY, slot: 18, value: 10, source: 'backup' },
    ]);
    expect(measuredWins[MONDAY - 1]![18]).toEqual({ value: 30, source: 'measured' });
  });

  it('a tie between a measured and a backup cell goes to MEASURED, in either order', () => {
    const measuredFirst = weekGridFromCells([
      { date: '2026-08-24', slot: 18, value: 20, source: 'measured' },
      { date: TODAY, slot: 18, value: 20, source: 'backup' },
    ]);
    expect(measuredFirst[MONDAY - 1]![18]).toEqual({ value: 20, source: 'measured' });

    const backupFirst = weekGridFromCells([
      { date: '2026-08-24', slot: 18, value: 20, source: 'backup' },
      { date: TODAY, slot: 18, value: 20, source: 'measured' },
    ]);
    expect(backupFirst[MONDAY - 1]![18]).toEqual({ value: 20, source: 'measured' });
  });

  // A reading of 0 is a DATA POINT, not an absence — the distinction the null contract rests on.
  it('a measured 0 keeps its cell rather than reading as no data', () => {
    const week = weekGridFromCells([{ date: TODAY, slot: 18, value: 0, source: 'measured' }]);
    expect(week[MONDAY - 1]![18]).toEqual({ value: 0, source: 'measured' });
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
