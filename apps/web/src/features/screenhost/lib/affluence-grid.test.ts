import { describe, expect, it } from 'vitest';

import { formatHour, summarize } from './affluence-grid';

// A zero-filled 7×24 grid with optional overrides at [day][hour].
const grid = (overrides: { day: number; hour: number; value: number }[] = []): number[][] => {
  const g = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
  for (const o of overrides) {
    const row = g[o.day];
    if (row) row[o.hour] = o.value;
  }
  return g;
};

describe('summarize', () => {
  it('returns null peaks + zeros for an empty grid', () => {
    const s = summarize(grid());
    expect(s.weeklyTotal).toBe(0);
    expect(s.dailyAverage).toBe(0);
    expect(s.peakDayIndex).toBeNull();
    expect(s.peakHourIndex).toBeNull();
    expect(s.maxHourValue).toBe(0);
  });

  it('computes weekly total, daily average, the busiest HOUR and the 7 per-day totals', () => {
    const s = summarize(
      grid([
        { day: 0, hour: 9, value: 100 },
        { day: 0, hour: 10, value: 40 },
        { day: 2, hour: 18, value: 250 },
      ]),
    );
    expect(s.weeklyTotal).toBe(390);
    expect(s.dailyAverage).toBe(Math.round(390 / 7)); // 56
    // Legacy 7×24 wire: an hour IS its cell, so FLOW-4 moves nothing here.
    expect(s.maxHourValue).toBe(250);
    expect(s.dayTotals).toEqual([140, 0, 250, 0, 0, 0, 0]); // Mon=140, Wed=250
  });

  it('finds the peak DAY by daily total', () => {
    const s = summarize(
      grid([
        { day: 0, hour: 9, value: 100 }, // Monday total 100
        { day: 4, hour: 12, value: 60 },
        { day: 4, hour: 13, value: 90 }, // Friday total 150 → peak
      ]),
    );
    expect(s.peakDayIndex).toBe(4); // Friday
    expect(s.peakDayTotal).toBe(150);
  });

  it('finds the peak HOUR by total across days', () => {
    const s = summarize(
      grid([
        { day: 0, hour: 18, value: 100 },
        { day: 1, hour: 18, value: 120 }, // hour 18 across days = 220 → peak
        { day: 2, hour: 9, value: 200 }, // hour 9 = 200
      ]),
    );
    expect(s.peakHourIndex).toBe(18);
    expect(s.peakHourTotal).toBe(220);
  });
});

// Slice C — the api's REAL wire: 7×48 SLOT columns (two per hour), overrides at [day][slot].
// HOUR-AVG2 — a slot with no reading is served as null (a measured 0 is a 0), so the helper is
// null-filled like the wire.
const slotGrid = (
  overrides: { day: number; slot: number; value: number | null }[] = [],
): (number | null)[][] => {
  const g = Array.from({ length: 7 }, () => Array.from({ length: 48 }, (): number | null => null));
  for (const o of overrides) {
    const row = g[o.day];
    if (row) row[o.slot] = o.value;
  }
  return g;
};

describe('DATA1 — « Votre audience »: Σ day tiles == « Audience hebdomadaire »', () => {
  it('on the served 7×48 slot grid, the week is exactly the sum of the 7 per-day tiles', () => {
    const s = summarize(
      slotGrid([
        { day: 0, slot: 18, value: 101 }, // Lun 09h00
        { day: 0, slot: 19, value: 33 }, // Lun 09h30
        { day: 2, slot: 36, value: 250 }, // Mer 18h00
        { day: 4, slot: 47, value: 7 }, // Ven 23h30 — the last slot counts too
        { day: 6, slot: 0, value: 12 }, // Dim 00h00
      ]),
    );
    // FLOW-4 — Lun 09h is the mean of 101 and 33 (67); every other hour holds a lone reading and
    // IS that reading. The cell sums (134 / 403) were FLOW-1's.
    expect(s.dayTotals).toEqual([67, 0, 250, 0, 7, 0, 12]);
    expect(s.dayTotals.reduce((a, b) => a + b, 0)).toBe(s.weeklyTotal);
    expect(s.weeklyTotal).toBe(336);
    expect(s.dailyAverage).toBe(Math.round(336 / 7));
  });

  it('rider — « Heure de pointe » folds the two half-hour slots into their HOUR on a slot grid', () => {
    const s = summarize(
      slotGrid([
        { day: 0, slot: 36, value: 100 }, // Lun 18h00 alone → Lun 18h = 100 (HOUR-AVG2)
        { day: 1, slot: 37, value: 120 }, // Mar 18h30 alone → Mar 18h = 120; hour 18 = 220
        { day: 2, slot: 18, value: 200 }, // Mer 09h00 alone → hour 9 = 200
        { day: 3, slot: 9, value: 150 }, // Jeu 04h30 — the old scan would have named « 09h »
      ]),
    );
    expect(s.peakHourIndex).toBe(18);
    expect(s.peakHourTotal).toBe(220);
    expect(formatHour(s.peakHourIndex ?? 0)).toBe('18h');
  });

  it('HOUR-AVG1 — an hour is the AVERAGE of its two half-hours, never their sum (Mejri 15/09)', () => {
    const s = summarize(
      slotGrid([
        { day: 0, slot: 20, value: 80 }, // Lun 10h00
        { day: 0, slot: 21, value: 80 }, // Lun 10h30 → 10h = 80, not 160
      ]),
    );
    expect(s.peakHourIndex).toBe(10);
    expect(s.peakHourTotal).toBe(80);
    // FLOW-4 — and so does the DAY now: the two readings describe one hour worth 80, not 160.
    expect(s.dayTotals[0]).toBe(80);
  });
});

// HOUR-AVG2 (operator 17/09, the hub's #97 rule) — an hour's value is the EXACT mean of the
// half-hour cells it HAS: a lone half is the hour, a measured 0 counts, two absent halves are no
// data. FLOW-4 (same day) — day and week totals now add those HOUR values instead of the raw
// half-hour cells, and the busiest figure is an HOUR value too. « everything works by the hour;
// only the readings come each 30 min. » It supersedes FLOW-1 (Mejri 04/09), knowingly.
describe('HOUR-AVG2 / FLOW-4 — an hour is the exact mean of the half-hours it has', () => {
  const peakOf = (first: number | null, second: number | null) =>
    summarize(
      slotGrid([
        { day: 0, slot: 20, value: first }, // Lun 10h00
        { day: 0, slot: 21, value: second }, // Lun 10h30
      ]),
    );

  it('17 + 18 → 17.5, never rounded', () => {
    const s = peakOf(17, 18);
    expect(s.peakHourIndex).toBe(10);
    expect(s.peakHourTotal).toBe(17.5);
  });

  it('10 + 20 → 15', () => {
    expect(peakOf(10, 20).peakHourTotal).toBe(15);
  });

  it('a lone half IS the hour — 12 gives 12, whichever half it is', () => {
    expect(peakOf(12, null).peakHourTotal).toBe(12);
    expect(peakOf(null, 12).peakHourTotal).toBe(12);
    expect(peakOf(12, null).dayTotals[0]).toBe(12);
    expect(peakOf(null, 12).dayTotals[0]).toBe(12);
  });

  it('a measured 0 is a value — 0 + 10 → 5 (Manaus, Sunday 1h: 10 and a measured 0)', () => {
    expect(peakOf(0, 10).peakHourTotal).toBe(5);
    expect(peakOf(10, 0).peakHourTotal).toBe(5);
    expect(peakOf(0, 10).dayTotals[0]).toBe(5); // and the day says 5 too (FLOW-4)
  });

  // The operator's own worked example, on the dashboard grid.
  it('FLOW-4 THE EXAMPLE: 09h 15 and 30 → 22.5, 10h a lone 20 → 20, the day is 42.5', () => {
    const s = summarize(
      slotGrid([
        { day: 0, slot: 18, value: 15 }, // Lun 09h00
        { day: 0, slot: 19, value: 30 }, // Lun 09h30 → 09h = 22.5
        { day: 0, slot: 20, value: 20 }, // Lun 10h00, no 10h30 at all → 10h = 20
      ]),
    );
    expect(s.dayTotals[0]).toBe(42.5); // the cell sum said 65
    expect(s.weeklyTotal).toBe(42.5);
    expect(s.maxHourValue).toBe(22.5); // the busiest HOUR, not the busiest cell (30)
    expect(s.peakDayIndex).toBe(0);
    expect(s.peakDayTotal).toBe(42.5);
  });

  it('two absent halves contribute nothing to the hour across the week', () => {
    const s = summarize(
      slotGrid([
        { day: 0, slot: 20, value: null }, // Lun 10h — no data at all
        { day: 0, slot: 21, value: null },
        { day: 1, slot: 20, value: 6 }, // Mar 10h00 alone
        { day: 2, slot: 30, value: 5 }, // Mer 15h00 alone
      ]),
    );
    expect(s.peakHourIndex).toBe(10);
    expect(s.peakHourTotal).toBe(6); // not 3: Monday's empty hour adds nothing, Tuesday's is 6
    expect(s.dayTotals).toEqual([0, 6, 5, 0, 0, 0, 0]);

    const empty = summarize(slotGrid());
    expect(empty.weeklyTotal).toBe(0);
    expect(empty.peakHourIndex).toBeNull();
    expect(empty.peakDayIndex).toBeNull();
    expect(empty.maxHourValue).toBe(0);
    expect(empty.dayTotals).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });

  it('the legacy 7×24 grid (one cell per hour) is unchanged; a null cell there adds nothing', () => {
    const legacy: (number | null)[][] = grid([
      { day: 0, hour: 18, value: 100 },
      { day: 1, hour: 18, value: 120 },
      { day: 2, hour: 9, value: 200 },
    ]);
    const row = legacy[3];
    if (row) row[18] = null;
    const s = summarize(legacy);
    expect(s.peakHourIndex).toBe(18);
    expect(s.peakHourTotal).toBe(220);
    // FLOW-4 leaves the legacy wire alone: with one cell per hour, the hour IS the cell.
    expect(s.weeklyTotal).toBe(420);
    expect(s.dayTotals).toEqual([100, 120, 200, 0, 0, 0, 0]);
    expect(s.maxHourValue).toBe(200);
  });
});

describe('formatHour', () => {
  it('zero-pads to NNh', () => {
    expect(formatHour(0)).toBe('00h');
    expect(formatHour(9)).toBe('09h');
    expect(formatHour(23)).toBe('23h');
  });
});
