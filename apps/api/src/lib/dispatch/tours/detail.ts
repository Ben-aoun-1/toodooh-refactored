import { type ToursPlanDetail } from '../../../db/schema.js';

import { type Calcul, type CalculParams } from './calculer.js';

// DISP-TOURS — the admin fiche's snapshot of one calculation, PURE (Mariem's spec §3.3): enough
// for an admin to redo the calculation and see why each venue received what it received — the
// parameters and the maximum (bloc 1), each venue's order, potential, tours, amount and status
// (bloc 2), its week grid with the tour that took each hour and its number of dates (bloc 3), and
// the engine journal's five phases with their result and duration (bloc 4).

export interface DetailInputs {
  calcul: Calcul;
  params: CalculParams & { fMaxSeconds: number; s: number; capHeure: number };
  budgetTnd: number;
  week: ReadonlyMap<string, readonly { dayOfWeek: number; hour: number; affluence: number }[]>;
  excluded: readonly { venueId: string; reason: string }[];
  journal: ToursPlanDetail['journal'];
  computedAt: Date;
}

export const buildToursDetail = (input: DetailInputs): ToursPlanDetail => {
  const { calcul, params } = input;
  // Which tour (and how many passages) took each (venue, weekday, hour).
  const taken = new Map<string, { tour: number; passages: number }>();
  for (const prise of calcul.final.prises) {
    for (const h of prise.tranche.heures) {
      taken.set(`${h.venueId}:${h.dayOfWeek}:${h.hour}`, {
        tour: prise.tranche.tour,
        passages: prise.passages,
      });
    }
  }
  return {
    computedAt: input.computedAt.toISOString(),
    params: {
      fMaxSeconds: params.fMaxSeconds,
      s: params.s,
      rPlein: params.rPlein,
      t: params.t,
      cpm: params.cpm,
      pctSh: params.pctSh,
      seuilShTnd: params.seuilShTnd,
      capHeure: params.capHeure,
    },
    budgetTnd: input.budgetTnd,
    iCible: calcul.iCible,
    iMax: calcul.iMax,
    cMaxTnd: calcul.cMaxTnd,
    iAlloue: calcul.iAlloue,
    prixTnd: calcul.prixTnd,
    venues: calcul.venues.map((v) => {
      const heures = calcul.heures.get(v.venueId) ?? [];
      const nByCell = new Map(heures.map((h) => [`${h.dayOfWeek}:${h.hour}`, h.n]));
      return {
        venueId: v.venueId,
        ordre: v.ordre,
        sps: v.sps,
        pleinImpressions: v.pleinImpressions,
        pleinMontantTnd: v.pleinMontantTnd,
        impressions: v.impressions,
        montantTnd: v.montantTnd,
        statut: v.statut,
        tours: v.tours,
        week: (input.week.get(v.venueId) ?? []).map((cell) => {
          const t = taken.get(`${v.venueId}:${cell.dayOfWeek}:${cell.hour}`);
          return {
            dayOfWeek: cell.dayOfWeek,
            hour: cell.hour,
            affluence: cell.affluence,
            n: nByCell.get(`${cell.dayOfWeek}:${cell.hour}`) ?? 0,
            tour: t?.tour ?? null,
            passages: t?.passages ?? null,
          };
        }),
      };
    }),
    excluded: [...input.excluded],
    journal: input.journal,
  };
};
