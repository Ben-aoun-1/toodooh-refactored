import { describe, expect, it } from 'vitest';

import {
  FALLBACK_HEATMAP_HOURS,
  PEAK_HOURS_LEAD,
  gridIsAllEmpty,
  heatmapHours,
  periodWeekGrid,
} from './peak-hours';

describe('PEAK_HOURS_LEAD (the byte-equality contract with the PDF)', () => {
  // The api pins the SAME literal over its template constant (report-template.test.ts). Neither
  // side can be reworded without its own pin failing — do not change one without the other.
  it('pins the exact wording', () => {
    expect(PEAK_HOURS_LEAD).toBe(
      "Audience moyenne par jour et par heure sur la période analysée, croisant les jours de la semaine et les heures d'ouverture. Plus la couleur est vive, plus l'audience est élevée. Les zones rayées correspondent à vos heures de fermeture ou aux créneaux sans données sur la période.",
    );
  });

  it('names the PERIOD (PERF-QA2) and no longer claims a rolling semaine type', () => {
    expect(PEAK_HOURS_LEAD).toContain('sur la période analysée');
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

describe('gridIsAllEmpty (R7 — the all-empty explanatory state)', () => {
  it('true only when NO cell is above 0', () => {
    expect(gridIsAllEmpty([])).toBe(true);
    expect(gridIsAllEmpty(Array.from({ length: 7 }, () => Array(24).fill(0) as number[]))).toBe(
      true,
    );
    const grid = Array.from({ length: 7 }, () => Array(24).fill(0) as number[]);
    (grid[3] as number[])[12] = 5;
    expect(gridIsAllEmpty(grid)).toBe(false);
  });
});

// ── PERF-QA2 — periodWeekGrid: S02 derives from the SELECTED PERIOD ───────────────────────────
// R7 ("rolling semaine type, never the period") superseded 2026-08-20. TWIN of the api's
// implementation (apps/api/src/lib/report/derive.ts) — the page and the PDF must apply the SAME
// rule to their own windows.
describe('periodWeekGrid', () => {
  /** A typical week where every day has the same 3-hour shape: 10h→10, 11h→20, 12h→30 (Σ 60). */
  const typical = (): number[][] =>
    Array.from({ length: 7 }, () =>
      Array.from({ length: 24 }, (_, h) => (h === 10 ? 10 : h === 11 ? 20 : h === 12 ? 30 : 0)),
    );
  const JUNE = { from: '2026-06-01', to: '2026-06-30' };

  it('an ESTIMATE-derived day reproduces the typical grid EXACTLY (the identity property)', () => {
    // 2026-06-01 is a Monday; its estimated audience is Σ of its own weekday row.
    const grid = periodWeekGrid(typical(), [{ date: '2026-06-01', audience: 60 }], JUNE);
    expect(grid[0]?.[10]).toBe(10);
    expect(grid[0]?.[11]).toBe(20);
    expect(grid[0]?.[12]).toBe(30);
    expect(grid[0]?.[9]).toBe(0);
  });

  it('a MEASURED day rescales the shape by its own total (amplitude, never profile)', () => {
    // Double the day's audience → every cell of that weekday doubles, the profile is unchanged.
    const grid = periodWeekGrid(typical(), [{ date: '2026-06-01', audience: 120 }], JUNE);
    expect(grid[0]?.[10]).toBe(20);
    expect(grid[0]?.[11]).toBe(40);
    expect(grid[0]?.[12]).toBe(60);
  });

  it('averages a weekday over ITS OCCURRENCES in the period, not over the period length', () => {
    // Two Mondays: 60 and 120 → the Monday row is the mean shape (90/60 of the profile).
    const grid = periodWeekGrid(
      typical(),
      [
        { date: '2026-06-01', audience: 60 },
        { date: '2026-06-08', audience: 120 },
      ],
      JUNE,
    );
    expect(grid[0]?.[10]).toBe(15);
    expect(grid[0]?.[12]).toBe(45);
    // Tuesday never occurred in the data → its row stays empty.
    expect(grid[1]?.[12]).toBe(0);
  });

  it('days OUTSIDE the period contribute nothing', () => {
    const grid = periodWeekGrid(typical(), [{ date: '2026-05-25', audience: 600 }], JUNE);
    expect(grid.flat().every((v) => v === 0)).toBe(true);
  });

  it('an EMPTY period yields an all-zero grid — the empty state fires by construction', () => {
    expect(gridIsAllEmpty(periodWeekGrid(typical(), [], JUNE))).toBe(true);
    expect(
      gridIsAllEmpty(periodWeekGrid(typical(), [{ date: '2026-06-03', audience: 0 }], JUNE)),
    ).toBe(true);
  });

  it('a weekday with NO hourly shape is dropped, never smeared flat', () => {
    const noShape = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
    const grid = periodWeekGrid(noShape, [{ date: '2026-06-01', audience: 500 }], JUNE);
    expect(grid.flat().every((v) => v === 0)).toBe(true);
  });

  it('keeps one decimal so a sub-1 measured cell is not hachured away', () => {
    // Monday audience 1 over a Σ-60 profile → 10/60 ≈ 0.17 → 0.2, still > 0 (coloured, not hachuré).
    const grid = periodWeekGrid(typical(), [{ date: '2026-06-01', audience: 1 }], JUNE);
    expect(grid[0]?.[10]).toBe(0.2);
    expect(grid[0]?.[12]).toBe(0.5);
  });

  it('maps Sunday to the LAST row (Monday-first), like the affluence grid', () => {
    // 2026-06-07 is a Sunday.
    const grid = periodWeekGrid(typical(), [{ date: '2026-06-07', audience: 60 }], JUNE);
    expect(grid[6]?.[12]).toBe(30);
    expect(grid[0]?.[12]).toBe(0);
  });

  it('ignores malformed dates instead of throwing', () => {
    expect(() =>
      periodWeekGrid(typical(), [{ date: 'pas-une-date', audience: 9 }], JUNE),
    ).not.toThrow();
  });
});
