import { describe, expect, it } from 'vitest';

import {
  FALLBACK_HEATMAP_HOURS,
  PEAK_HOURS_LEAD,
  gridHasNoMeasure,
  heatmapHours,
  measuredLevel,
  measuredScale,
  periodWeekGrid,
} from './peak-hours';

describe('PEAK_HOURS_LEAD (the byte-equality contract with the PDF)', () => {
  // The api pins the SAME literal over its template constant (report-template.test.ts). Neither
  // side can be reworded without its own pin failing — do not change one without the other.
  it('pins the exact wording', () => {
    expect(PEAK_HOURS_LEAD).toBe(
      "Audience mesurée par votre capteur, croisant les jours de la semaine et les heures d'ouverture sur la période analysée. Plus la couleur est vive, plus l'audience mesurée est élevée. Les zones rayées correspondent à vos heures de fermeture ou aux créneaux sans aucune mesure sur la période.",
    );
  });

  it('names the MEASURE and the period (US-P.5), never a rolling semaine type', () => {
    expect(PEAK_HOURS_LEAD).toContain('Audience mesurée par votre capteur');
    expect(PEAK_HOURS_LEAD).toContain('sur la période analysée');
    expect(PEAK_HOURS_LEAD).toContain('sans aucune mesure sur la période');
    expect(PEAK_HOURS_LEAD).not.toContain('semaine type');
    expect(PEAK_HOURS_LEAD).not.toContain('moyenne glissante');
  });
});

describe('heatmapHours (R7 — real venue hours, 14h window only as fallback)', () => {
  it('derives the columns from [opening, closing)', () => {
    expect(heatmapHours(10, 14)).toEqual([10, 11, 12, 13]);
    expect(heatmapHours(0, 24)).toHaveLength(24);
  });

  it('falls back to the 8h–21h mockup window ONLY when hours are unknown or degenerate', () => {
    expect(heatmapHours(null, 21)).toEqual([...FALLBACK_HEATMAP_HOURS]);
    expect(heatmapHours(8, null)).toEqual([...FALLBACK_HEATMAP_HOURS]);
    expect(heatmapHours(21, 8)).toEqual([...FALLBACK_HEATMAP_HOURS]); // overnight deferred
    expect(FALLBACK_HEATMAP_HOURS).toEqual([8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21]);
  });

  it('clamps out-of-range bounds instead of producing phantom hours', () => {
    expect(heatmapHours(-2, 3)).toEqual([0, 1, 2]);
    expect(heatmapHours(22, 30)).toEqual([22, 23]);
  });
});

describe('periodWeekGrid (measured)', () => {
  const JUNE = { from: '2026-06-01', to: '2026-06-30' };
  const ONE_WEEK = { from: '2026-06-01', to: '2026-06-07' }; // Monday → Sunday

  it('a ≤ 1-week filter shows the RAW Ai_jh of that week (exact, for the tooltip)', () => {
    const grid = periodWeekGrid(
      [
        { date: '2026-06-01', hour: 10, audience: 7 }, // Monday
        { date: '2026-06-07', hour: 18, audience: 43 }, // Sunday
      ],
      ONE_WEEK,
    );
    expect(grid[0]?.[10]).toBe(7);
    expect(grid[6]?.[18]).toBe(43);
  });

  it('a > 1-week filter averages each (weekday, hour) over the weeks that HAVE a measure', () => {
    const grid = periodWeekGrid(
      [
        { date: '2026-06-01', hour: 10, audience: 10 }, // Monday, week 1
        { date: '2026-06-08', hour: 10, audience: 20 }, // Monday, week 2
        { date: '2026-06-15', hour: 10, audience: 30 }, // Monday, week 3
      ],
      JUNE,
    );
    // Mean over the THREE measured occurrences — the two unmeasured Mondays of June contribute
    // nothing (counting them as 0 would invent a measurement).
    expect(grid[0]?.[10]).toBe(20);
  });

  it('a cell with NO measure is null — hachure, never a coloured 0', () => {
    const grid = periodWeekGrid([{ date: '2026-06-01', hour: 10, audience: 5 }], JUNE);
    expect(grid[0]?.[11]).toBeNull();
    expect(grid[3]?.[10]).toBeNull();
  });

  it('a MEASURED zero is a measure — it colours at the bottom of the ramp, never hachured', () => {
    const grid = periodWeekGrid(
      [
        { date: '2026-06-01', hour: 10, audience: 0 },
        { date: '2026-06-01', hour: 11, audience: 40 },
      ],
      ONE_WEEK,
    );
    expect(grid[0]?.[10]).toBe(0);
    const scale = measuredScale([grid[0]?.[10] ?? null, grid[0]?.[11] ?? null]);
    expect(measuredLevel(grid[0]?.[10] ?? null, scale)).toBe(1);
    expect(measuredLevel(null, scale)).toBe(0);
  });

  it('measures OUTSIDE the period contribute nothing', () => {
    const grid = periodWeekGrid([{ date: '2026-05-25', hour: 10, audience: 900 }], JUNE);
    expect(grid.every((row) => row.every((v) => v === null))).toBe(true);
  });

  it('an empty measured source yields an all-null grid (the estimate never fills in)', () => {
    const grid = periodWeekGrid([], JUNE);
    expect(grid).toHaveLength(7);
    expect(grid.every((row) => row.length === 24 && row.every((v) => v === null))).toBe(true);
  });

  it('maps Sunday to the LAST row (Monday-first), like the affluence grid', () => {
    const grid = periodWeekGrid([{ date: '2026-06-07', hour: 12, audience: 3 }], ONE_WEEK);
    expect(grid[6]?.[12]).toBe(3);
    expect(grid[0]?.[12]).toBeNull();
  });

  it('drops malformed dates and out-of-range hours instead of throwing', () => {
    expect(() =>
      periodWeekGrid(
        [
          { date: 'pas-une-date', hour: 10, audience: 9 },
          { date: '2026-06-01', hour: 24, audience: 9 },
          { date: '2026-06-01', hour: -1, audience: 9 },
        ],
        JUNE,
      ),
    ).not.toThrow();
    expect(
      periodWeekGrid([{ date: '2026-06-01', hour: 24, audience: 9 }], JUNE)[0]?.[0],
    ).toBeNull();
  });
});

describe('measuredScale / measuredLevel', () => {
  it('the scale is the PERIOD’s own observed min/max, ignoring unmeasured cells', () => {
    expect(measuredScale([null, 4, null, 12])).toEqual({ min: 4, max: 12 });
    expect(measuredScale([null, null])).toBeNull();
  });

  it('ramps 1→5 linearly between min and max', () => {
    const scale = { min: 0, max: 100 };
    expect(measuredLevel(0, scale)).toBe(1);
    expect(measuredLevel(20, scale)).toBe(1);
    expect(measuredLevel(21, scale)).toBe(2);
    expect(measuredLevel(60, scale)).toBe(3);
    expect(measuredLevel(100, scale)).toBe(5);
  });

  it('level 0 is reserved for NO MEASURE (null value, or no scale at all)', () => {
    expect(measuredLevel(null, { min: 0, max: 10 })).toBe(0);
    expect(measuredLevel(5, null)).toBe(0);
  });

  it('a period whose measures are all equal reads at the neutral middle, not a peak', () => {
    expect(measuredLevel(7, { min: 7, max: 7 })).toBe(3);
  });
});

describe('gridHasNoMeasure', () => {
  it('is true only when NOT ONE cell carries a measure', () => {
    const empty: (number | null)[][] = Array.from({ length: 7 }, () =>
      Array.from({ length: 24 }, () => null),
    );
    expect(gridHasNoMeasure(empty)).toBe(true);
    // A measured ZERO is still a measure — the section must NOT fall back to its empty state.
    const one = periodWeekGrid([{ date: '2026-06-01', hour: 9, audience: 0 }], {
      from: '2026-06-01',
      to: '2026-06-30',
    });
    expect(gridHasNoMeasure(one)).toBe(false);
  });
});
