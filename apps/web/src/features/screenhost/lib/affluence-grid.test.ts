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
    expect(s.maxCell).toBe(0);
  });

  it('computes weekly total, daily average, the busiest cell and the 7 per-day totals', () => {
    const s = summarize(
      grid([
        { day: 0, hour: 9, value: 100 },
        { day: 0, hour: 10, value: 40 },
        { day: 2, hour: 18, value: 250 },
      ]),
    );
    expect(s.weeklyTotal).toBe(390);
    expect(s.dailyAverage).toBe(Math.round(390 / 7)); // 56
    expect(s.maxCell).toBe(250);
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
const slotGrid = (overrides: { day: number; slot: number; value: number }[] = []): number[][] => {
  const g = Array.from({ length: 7 }, () => Array.from({ length: 48 }, () => 0));
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
    expect(s.dayTotals).toEqual([134, 0, 250, 0, 7, 0, 12]);
    expect(s.dayTotals.reduce((a, b) => a + b, 0)).toBe(s.weeklyTotal);
    expect(s.weeklyTotal).toBe(403);
    expect(s.dailyAverage).toBe(Math.round(403 / 7));
  });

  it('rider — « Heure de pointe » folds the two half-hour slots into their HOUR on a slot grid', () => {
    const s = summarize(
      slotGrid([
        { day: 0, slot: 36, value: 100 }, // Lun 18h00 → Lun 18h = (100 + 0) / 2 = 50
        { day: 1, slot: 37, value: 120 }, // Mar 18h30 → Mar 18h = 60; hour 18 across days = 110
        { day: 2, slot: 18, value: 200 }, // Mer 09h00 → hour 9 = 100
        { day: 3, slot: 9, value: 150 }, // Jeu 04h30 — the old scan would have named « 09h »
      ]),
    );
    expect(s.peakHourIndex).toBe(18);
    expect(s.peakHourTotal).toBe(110);
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
    // The day still counts both readings (FLOW-1).
    expect(s.dayTotals[0]).toBe(160);
  });
});

describe('formatHour', () => {
  it('zero-pads to NNh', () => {
    expect(formatHour(0)).toBe('00h');
    expect(formatHour(9)).toBe('09h');
    expect(formatHour(23)).toBe('23h');
  });
});
