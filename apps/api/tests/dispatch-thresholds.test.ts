import { describe, expect, it } from 'vitest';

import {
  DISPATCH_CONFIG_DEFAULTS,
  computeGJour,
  computeSMin,
} from '../src/lib/dispatch/thresholds.js';

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
