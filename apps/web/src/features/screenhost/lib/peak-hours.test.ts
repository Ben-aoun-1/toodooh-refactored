import { describe, expect, it } from 'vitest';

import {
  FALLBACK_HEATMAP_HOURS,
  HEATMAP_HINT,
  PEAK_HOURS_EMPTY_TITLE,
  PEAK_HOURS_LEAD,
  heatmapCellTitle,
  heatmapHours,
  heatmapLevel,
  heatmapScale,
  peakHoursEmpty,
  slotLabel,
  heatmapSlots,
  collapseHourCell,
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

// MEJ-3 (Mejri 31/08 pt 3) — the S02 cell readout. It was an inline native `title`: unpinnable
// (no render harness) and, on a fast traverse of 26px cells, one cell behind the cursor. The
// string lives here now and the component feeds it the SAME descriptor it colours the cell from.
// ── Slice C — the half-hour heatmap rules ────────────────────────────────────────────────────
//
// These cannot be pinned through the component (WEB-GATE1: apps/web has no render harness), so
// they live here and the component only lays them out.
describe('slotLabel — the venue clock, both halves', () => {
  it('the :00 half keeps the plain hour, the :30 half says so', () => {
    expect(slotLabel(26)).toBe('13h');
    expect(slotLabel(27)).toBe('13h30');
    expect(slotLabel(0)).toBe('0h');
    expect(slotLabel(47)).toBe('23h30');
  });
});

describe('heatmapSlots — two columns per open hour, in order', () => {
  it('an 8h–10h venue yields 8h, 8h30, 9h, 9h30', () => {
    expect(heatmapSlots(8, 10)).toEqual([16, 17, 18, 19]);
  });

  it('unknown hours fall back to the mockup window, still doubled', () => {
    expect(heatmapSlots(null, null)).toHaveLength(28); // 14 hours × 2
    expect(heatmapSlots(null, null)[0]).toBe(16); // 8h00
  });
});

describe('collapseHourCell — what ONE column shows at ≤375 px', () => {
  it('two measured halves collapse to their mean, still measured', () => {
    expect(
      collapseHourCell([
        { value: 100, kind: 'measured' },
        { value: 200, kind: 'measured' },
      ]),
    ).toEqual({ value: 150, kind: 'measured' });
  });

  it('MIXTE: a measured half beside an ESTIMATED one — the disagreement a phone cannot show', () => {
    expect(
      collapseHourCell([
        { value: 200, kind: 'measured' },
        { value: 40, kind: 'backup' },
      ]),
    ).toEqual({ value: 120, kind: 'mixte' });
  });

  it('a measured half beside an EMPTY one stays MEASURED, and is not halved towards a zero', () => {
    // Nothing contradicts the measure, so the hour is measured; and averaging against an absent
    // reading would invent a 0 the sensor never observed.
    expect(
      collapseHourCell([
        { value: 200, kind: 'measured' },
        { value: null, kind: 'none' },
      ]),
    ).toEqual({ value: 200, kind: 'measured' });
  });

  it('two estimated halves stay an estimation — mixte never widens to « not clearly measured »', () => {
    expect(
      collapseHourCell([
        { value: 10, kind: 'backup' },
        { value: 20, kind: 'backup' },
      ]),
    ).toEqual({ value: 15, kind: 'backup' });
  });

  it('an hour with nothing in either half is no data at all', () => {
    expect(
      collapseHourCell([
        { value: null, kind: 'none' },
        { value: null, kind: 'none' },
      ]),
    ).toEqual({ value: null, kind: 'none' });
  });

  it('the collapsed value rounds, matching the api rule for an hour-keyed consumer', () => {
    expect(
      collapseHourCell([
        { value: 100, kind: 'measured' },
        { value: 101, kind: 'measured' },
      ]),
    ).toEqual({ value: 101, kind: 'measured' }); // 100.5 → 101
  });
});

describe('heatmapCellTitle — the cell says what it renders and where it comes from', () => {
  // fr-FR groups thousands with a NARROW NO-BREAK SPACE (U+202F), not a plain space — spelled
  // out here so the pin cannot be "fixed" by typing an ordinary space that then never matches.
  it('names the slot, the value and « mesuré » for a sensor cell', () => {
    expect(
      heatmapCellTitle({ dayLabel: 'Lun', slot: 26, closed: false, kind: 'measured', value: 1396 }),
    ).toBe('Lun 13h — 1\u202f396 pers. (mesuré)');
  });

  it('says « estimation » for a backup cell — the value is never dressed as a measure', () => {
    expect(
      heatmapCellTitle({ dayLabel: 'Sam', slot: 18, closed: false, kind: 'backup', value: 80 }),
    ).toBe('Sam 9h — 80 pers. (estimation)');
  });

  it('a data-less cell claims no number', () => {
    expect(
      heatmapCellTitle({ dayLabel: 'Dim', slot: 40, closed: false, kind: 'none', value: 0 }),
    ).toBe('Dim 20h — aucune donnée');
  });

  it('closed wins over everything — outside the hours there is no audience to describe', () => {
    expect(
      heatmapCellTitle({ dayLabel: 'Mar', slot: 6, closed: true, kind: 'measured', value: 500 }),
    ).toBe('Mar 3h — fermé');
  });

  it('a measured 0 still reads as a measure (AFF1: a measured zero IS a measurement)', () => {
    expect(
      heatmapCellTitle({ dayLabel: 'Jeu', slot: 16, closed: false, kind: 'measured', value: 0 }),
    ).toBe('Jeu 8h — 0 pers. (mesuré)');
  });

  it('the resting caption invites the gesture instead of showing a stale cell', () => {
    expect(HEATMAP_HINT).toBe('Survolez une case pour en lire la valeur et sa source.');
  });
});
