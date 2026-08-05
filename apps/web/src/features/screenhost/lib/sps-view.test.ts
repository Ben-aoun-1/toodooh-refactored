import { describe, expect, it } from 'vitest';

import { spsCriteria, spsScoreLabel } from './sps-view';

const variables = {
  acceptation: { value: 72.5, weight: 40 },
  respect_evenements: { value: 100, weight: 30 },
  activite: { value: 0, weight: 20 },
  remplissage: { value: 33.33, weight: 10 },
};

describe('spsCriteria (R6 — weights from the WIRE, labels mirror the PDF)', () => {
  it('builds the four ruled criteria in order, weights straight off the wire', () => {
    const rows = spsCriteria(variables);
    expect(rows.map((r) => r.label)).toEqual([
      "Taux d'acceptation des campagnes",
      'Respect des événements acceptés',
      "Activité de l'écran",
      'Taux de remplissage',
    ]);
    expect(rows.map((r) => r.weightLabel)).toEqual([
      'poids 40 %',
      'poids 30 %',
      'poids 20 %',
      'poids 10 %',
    ]);
    expect(rows[0]?.valueLabel).toBe('72,5 / 100');
    expect(rows[1]?.valueLabel).toBe('100 / 100');
    expect(rows[2]?.valueLabel).toBe('0 / 100');
  });

  it('never hardcodes the weights — an admin-edited config flows through verbatim', () => {
    // The 25/30/20/10 Σ-85 % stub era: any wire weights must surface untouched.
    const edited = spsCriteria({
      acceptation: { value: 50, weight: 35 },
      respect_evenements: { value: 50, weight: 25 },
      activite: { value: 50, weight: 25 },
      remplissage: { value: 50, weight: 15 },
    });
    expect(edited.map((r) => r.weightLabel)).toEqual([
      'poids 35 %',
      'poids 25 %',
      'poids 25 %',
      'poids 15 %',
    ]);
  });

  it('clamps the bar fill to [0, 100]', () => {
    const rows = spsCriteria({
      ...variables,
      acceptation: { value: 120, weight: 40 },
      activite: { value: -5, weight: 20 },
    });
    expect(rows[0]?.pct).toBe(100);
    expect(rows[2]?.pct).toBe(0);
  });
});

describe('spsScoreLabel', () => {
  it('fr-FR one-decimal style; « À venir » while no score exists', () => {
    expect(spsScoreLabel(70)).toBe('70');
    expect(spsScoreLabel(72.5)).toBe('72,5');
    expect(spsScoreLabel(null)).toBe('À venir');
  });
});
