import { describe, expect, it } from 'vitest';

import { AUDIENCE_KPIS_LEAD, NO_MEASURE_NOTE, PER_HOUR_DESC } from './audience-copy';

// PERF-R1 — the S01 lead + the no-measure note are BYTE-IDENTICAL twins of the api's
// template.ts constants, each side pinned by an exact-literal test (the PEAK_HOURS_LEAD
// convention). Do not reword one without the other.
describe('S01 copy (byte-equality contract with the PDF)', () => {
  it('pins the S01 lead', () => {
    expect(AUDIENCE_KPIS_LEAD).toBe(
      "Indicateurs de densité d'audience dans votre lieu sur la période analysée — mesure du capteur en priorité, estimation en secours — croisés avec vos heures d'ouverture.",
    );
  });

  it('pins the no-measure note (shown ONLY when neither a reading nor a backup fed the période)', () => {
    expect(NO_MEASURE_NOTE).toBe(
      "Aucune mesure du capteur d'audience sur la période — les impressions proviennent de la preuve de diffusion, une source indépendante.",
    );
  });

  // FLOW-4 (operator 17/09) — moyenne/heure is Pers_atteintes ÷ heures d'ouverture, the day being
  // Σ of its HOUR values and an hour the mean of its readings. The « moyenne des deux demi-heures »
  // wording described FLOW-1's ÷ 2 and no longer describes the figure. Reworded on BOTH sides in
  // the same commit — the twin test in apps/api pins the same literal.
  it('pins the per-hour description (byte-twin of the api PER_HOUR_DESC)', () => {
    expect(PER_HOUR_DESC).toBe(
      "Personnes détectées par heure d'ouverture, moyenne de ses demi-heures",
    );
    expect(PER_HOUR_DESC).not.toContain('Densité');
    expect(PER_HOUR_DESC).not.toContain('des deux demi-heures'); // FLOW-1's ÷ 2 wording
  });
});
