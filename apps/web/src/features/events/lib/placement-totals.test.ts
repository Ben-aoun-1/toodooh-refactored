import { describe, expect, it } from 'vitest';

import { placementTotals } from './placement-totals';

describe('placementTotals — Consulter shows totals, never venues (Q4A)', () => {
  it('sums the live offers: venues, accepted/pending, minutes, montant', () => {
    expect(
      placementTotals([
        { statut: 'ACCEPTE', blocs_count: 6, montant_tnd: 6.18 },
        { statut: 'EN_ATTENTE', blocs_count: 6, montant_tnd: 7.02 },
        { statut: 'ACCEPTE', blocs_count: 3, montant_tnd: 5.49 },
      ]),
    ).toEqual({ venues: 3, accepted: 2, pending: 1, minutes: 15, montantTnd: 18.69 });
  });

  it('a refused offer places nothing and counts nowhere', () => {
    expect(
      placementTotals([
        { statut: 'REFUSE', blocs_count: 6, montant_tnd: 10.98 },
        { statut: 'ACCEPTE', blocs_count: 6, montant_tnd: 2.4 },
      ]),
    ).toEqual({ venues: 1, accepted: 1, pending: 0, minutes: 6, montantTnd: 2.4 });
  });
});
