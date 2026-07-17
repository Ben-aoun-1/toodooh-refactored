import { describe, expect, it } from 'vitest';

import {
  DISPATCH_CONFIG_DEFAULTS,
  computeGJour,
  computeSMin,
  seuilImpressions,
} from '../src/lib/dispatch/thresholds.js';
import { S_MIN_TND, SEUIL_DIFFUSABLE } from '../src/lib/vf-constants.js';

// The three seuils are RELATED, wired once — these pin the relations so they are never re-derived
// as literals in the algorithm.
describe('dispatch threshold relations', () => {
  it('S_min = seuil_diffusable × CPM ÷ 1000', () => {
    expect(computeSMin(1000, 5)).toBe(5); // 1000 × 5 / 1000
    expect(computeSMin(2000, 7.5)).toBe(15);
    expect(computeSMin(0, 5)).toBe(0);
  });

  it('G_jour = G_mois ÷ jours_actifs (guarded against /0)', () => {
    expect(computeGJour(300, 30)).toBe(10);
    expect(computeGJour(100, 0)).toBe(0);
  });

  it('exposes the V1 POC defaults (calibratable config, not literals in the algorithm)', () => {
    expect(DISPATCH_CONFIG_DEFAULTS).toMatchObject({
      seuilDiffusable: 1000,
      gMois: 100,
      joursActifs: 30,
      rMinEfficace: 2,
      fMaxSeconds: 300,
    });
  });
});

// E3 (Mariem 2026-07-15 amendment) — the anti-miette seuil is VALUE-based: the same S_min = 20 TND
// rule as redispatch, translated into facturable impressions at the campaign's CPM.
describe('seuilImpressions — the value-based anti-miette threshold (E3 amendment)', () => {
  it('S_MIN_TND × 1000 ÷ CPM, ceiled: CPM 15 → 1 334, CPM 30 → 667, CPM 10 → 2 000', () => {
    expect(seuilImpressions(15)).toBe(1334); // ⌈1333.33…⌉ — 1 333 imp. would be worth < 20 TND
    expect(seuilImpressions(30)).toBe(667); // ⌈666.66…⌉
    expect(seuilImpressions(10)).toBe(2000); // exact division
    expect(seuilImpressions(20)).toBe(1000); // exact division
  });

  it('boundary is exact: the threshold is worth ≥ S_MIN_TND, one impression below is not', () => {
    for (const cpm of [10, 15, 20, 30, 7.5, 12.3]) {
      const seuil = seuilImpressions(cpm);
      expect((seuil * cpm) / 1000).toBeGreaterThanOrEqual(S_MIN_TND);
      expect(((seuil - 1) * cpm) / 1000).toBeLessThan(S_MIN_TND);
    }
  });

  it('fails loud on a non-positive CPM (never a silent zero threshold)', () => {
    expect(() => seuilImpressions(0)).toThrow();
    expect(() => seuilImpressions(-15)).toThrow();
  });

  it('supersedes (not deletes) the fixed pins: SEUIL_DIFFUSABLE=5000 and config seuil stay', () => {
    // The E1 constant and the config column stay in place (removal banked) but no longer feed
    // dispatch — the dispatch/cascade path derives the seuil from CPM.
    expect(SEUIL_DIFFUSABLE).toBe(5000);
    expect(DISPATCH_CONFIG_DEFAULTS.seuilDiffusable).toBe(1000);
    expect(seuilImpressions(15)).not.toBe(SEUIL_DIFFUSABLE);
  });
});
