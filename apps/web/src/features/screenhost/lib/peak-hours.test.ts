import { describe, expect, it } from 'vitest';

import {
  FALLBACK_HEATMAP_HOURS,
  PEAK_HOURS_LEAD,
  gridIsAllEmpty,
  heatmapHours,
} from './peak-hours';

describe('PEAK_HOURS_LEAD (R7 — the byte-equality contract with the PDF)', () => {
  // The api pins the SAME literal over its template constant (report-template.test.ts). Neither
  // side can be reworded without its own pin failing — do not change one without the other.
  it('pins the exact wording', () => {
    expect(PEAK_HOURS_LEAD).toBe(
      "Audience moyenne de votre semaine type (moyenne glissante sur les 4 dernières semaines), croisant les jours de la semaine et les heures d'ouverture. Plus la couleur est vive, plus l'audience est élevée. Les zones rayées correspondent à vos heures de fermeture ou aux créneaux sans données mesurées.",
    );
  });

  it('claims the semaine type and never the period', () => {
    expect(PEAK_HOURS_LEAD).toContain('semaine type');
    expect(PEAK_HOURS_LEAD).not.toContain("sur l'ensemble de la période");
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
