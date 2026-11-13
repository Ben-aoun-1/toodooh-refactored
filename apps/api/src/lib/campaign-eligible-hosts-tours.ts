import { db } from '../db/client.js';
import { type ToursPlanDetail } from '../db/schema.js';

import { calculerCampagne } from './dispatch/tours/campaign-calcul.js';

// DISP-TOURS — the admin fiche of a standard campaign on the tours engine (Mariem's spec §3.3):
// « que l'admin puisse refaire le calcul et voir pourquoi chaque Screenhost a reçu ce qu'il a
// reçu ». A LAUNCHED campaign shows the snapshot frozen with its plan (the figures it was sold
// at, never recomputed); one not launched yet is calculated NOW at its stored budget (the cart's
// own calculation — nothing is written, nothing reserved).

export interface ToursFicheVenue {
  id: string;
  name: string;
  sector: string | null;
  class: string | null;
  sps: number;
  ordre: number;
  plein_impressions: number;
  plein_montant_tnd: number;
  impressions: number;
  montant_tnd: number;
  statut: ToursPlanDetail['venues'][number]['statut'];
  tours: { tour: number; passages: number }[];
  week: {
    day_of_week: number;
    hour: number;
    affluence: number;
    n: number;
    tour: number | null;
    passages: number | null;
  }[];
}

export interface ToursFicheWire {
  /** 'plan' = frozen at the launch; 'live' = calculated now (not launched yet). */
  source: 'plan' | 'live';
  computed_at: string;
  params: {
    f_max_seconds: number;
    s: number;
    r_plein: number;
    t: number;
    cpm: number;
    pct_sh: number;
    seuil_sh_tnd: number;
    cap_heure: number;
  };
  budget_tnd: number;
  i_cible: number;
  i_max: number;
  c_max_tnd: number;
  i_alloue: number;
  prix_tnd: number;
  venues: ToursFicheVenue[];
  journal: ToursPlanDetail['journal'];
}

export interface VenueNames {
  get(id: string): { name: string; sector: string | null; class: string | null } | undefined;
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** The wire shape of a frozen or live calculation, with the venues' names. */
export const toursFiche = (
  detail: ToursPlanDetail,
  source: 'plan' | 'live',
  labels: VenueNames,
): ToursFicheWire => ({
  source,
  computed_at: detail.computedAt,
  params: {
    f_max_seconds: detail.params.fMaxSeconds,
    s: detail.params.s,
    r_plein: detail.params.rPlein,
    t: detail.params.t,
    cpm: detail.params.cpm,
    pct_sh: detail.params.pctSh,
    seuil_sh_tnd: detail.params.seuilShTnd,
    cap_heure: detail.params.capHeure,
  },
  budget_tnd: round4(detail.budgetTnd),
  i_cible: round4(detail.iCible),
  i_max: round4(detail.iMax),
  c_max_tnd: round4(detail.cMaxTnd),
  i_alloue: round4(detail.iAlloue),
  prix_tnd: round4(detail.prixTnd),
  venues: detail.venues.map((v) => {
    const label = labels.get(v.venueId);
    return {
      id: v.venueId,
      name: label?.name ?? v.venueId,
      sector: label?.sector ?? null,
      class: label?.class ?? null,
      sps: v.sps,
      ordre: v.ordre,
      plein_impressions: round4(v.pleinImpressions),
      plein_montant_tnd: round4(v.pleinMontantTnd),
      impressions: round4(v.impressions),
      montant_tnd: round4(v.montantTnd),
      statut: v.statut,
      tours: v.tours,
      week: v.week.map((c) => ({
        day_of_week: c.dayOfWeek,
        hour: c.hour,
        affluence: c.affluence,
        n: c.n,
        tour: c.tour,
        passages: c.passages,
      })),
    };
  }),
  journal: detail.journal,
});

/** A campaign not launched yet, calculated now at its stored budget (the maximum without one). */
export const liveToursDetail = async (
  campaign: { id: string; startDate: string; endDate: string },
  inputs: { s: number; t: number; cpm: number; budgetTnd: number | null },
): Promise<{ detail: ToursPlanDetail; excluded: { venueId: string; reason: string }[] }> => {
  const { detail, pool } = await calculerCampagne(
    db,
    campaign,
    {
      s: inputs.s,
      t: inputs.t,
      cpm: inputs.cpm,
      budgetTnd: inputs.budgetTnd ?? Number.POSITIVE_INFINITY,
    },
    { typicalWeek: 'live' },
  );
  return { detail, excluded: pool.excluded };
};
