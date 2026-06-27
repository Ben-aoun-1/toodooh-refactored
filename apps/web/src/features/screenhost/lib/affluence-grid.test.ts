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

describe('formatHour', () => {
  it('zero-pads to NNh', () => {
    expect(formatHour(0)).toBe('00h');
    expect(formatHour(9)).toBe('09h');
    expect(formatHour(23)).toBe('23h');
  });
});
