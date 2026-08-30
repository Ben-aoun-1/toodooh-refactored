import { describe, expect, it } from 'vitest';

import {
  FALLBACK_HEATMAP_HOURS,
  PEAK_HOURS_EMPTY_TITLE,
  PEAK_HOURS_LEAD,
  heatmapHours,
  heatmapLevel,
  heatmapScale,
  peakHoursEmpty,
} from './peak-hours';

describe('PEAK_HOURS_LEAD (the byte-equality contract with the PDF)', () => {
  // The api pins the SAME literal over its template constant (report-template.test.ts). Neither
  // side can be reworded without its own pin failing — do not change one without the other.
  it('pins the exact wording', () => {
    expect(PEAK_HOURS_LEAD).toBe(
      "Semaine type de votre audience sur la période analysée, croisant les jours de la semaine et les heures d'ouverture — mesure de votre capteur en priorité, estimation en secours. Plus la couleur est vive, plus l'audience est élevée. Les cases pleines sont mesurées par votre capteur, les cases en pointillé sont des estimations. Les zones rayées correspondent à vos heures de fermeture, aux jours hors période ou aux créneaux sans aucune donnée.",
    );
  });

  it('PERF-R2 — names the période scope AND both provenances', () => {
    expect(PEAK_HOURS_LEAD).toContain('Semaine type');
    expect(PEAK_HOURS_LEAD).toContain('période analysée'); // the période scopes S02 now
    expect(PEAK_HOURS_LEAD).toContain('mesure de votre capteur en priorité');
    expect(PEAK_HOURS_LEAD).toContain('estimation en secours');
    expect(PEAK_HOURS_LEAD).toContain('jours hors période'); // the weekday mask is explained
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

describe('heatmapScale / heatmapLevel', () => {
  it('the scale is the grid’s own observed min/max over cells that CARRY data', () => {
    expect(heatmapScale([null, 4, null, 12])).toEqual({ min: 4, max: 12 });
    expect(heatmapScale([null, null])).toBeNull();
  });

  it('ramps 1→5 linearly between min and max', () => {
    const scale = { min: 0, max: 100 };
    expect(heatmapLevel(0, scale)).toBe(1);
    expect(heatmapLevel(20, scale)).toBe(1);
    expect(heatmapLevel(21, scale)).toBe(2);
    expect(heatmapLevel(60, scale)).toBe(3);
    expect(heatmapLevel(100, scale)).toBe(5);
  });

  it('level 0 is reserved for NO DATA (null value, or no scale at all)', () => {
    expect(heatmapLevel(null, { min: 0, max: 10 })).toBe(0);
    expect(heatmapLevel(5, null)).toBe(0);
  });

  it('a grid whose values are all equal reads at the neutral middle, not a peak', () => {
    expect(heatmapLevel(7, { min: 7, max: 7 })).toBe(3);
  });
});

describe('PEAK_HOURS_EMPTY_TITLE (AFF1 amendment — S02 is not period-scoped)', () => {
  it('pins the exact wording, without « sur cette période »', () => {
    expect(PEAK_HOURS_EMPTY_TITLE).toBe("Pas encore de mesure d'audience");
    expect(PEAK_HOURS_EMPTY_TITLE).not.toContain('période');
  });
});

describe('peakHoursEmpty (AFF1 ruling)', () => {
  it('is the explanatory state ONLY when no measured, no backup AND no data', () => {
    expect(peakHoursEmpty({ has_data: false, counts: { measured: 0, backup: 0 } })).toBe(true);
    // A NULL-source-only venue HAS data → renders as estimation, never the empty state.
    expect(peakHoursEmpty({ has_data: true, counts: { measured: 0, backup: 0 } })).toBe(false);
    expect(peakHoursEmpty({ has_data: true, counts: { measured: 0, backup: 5 } })).toBe(false);
  });
});
