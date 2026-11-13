import {
  type RemplissageFinal,
  type SeuilParams,
  montantSh,
  remplirAvecSeuil,
  sousSeuil,
} from './anti-miette.js';
import { type FileVenue, type Tranche, buildFile, orderPool } from './file.js';
import {
  type HeureType,
  type VenueInput,
  buildHeuresTypes,
  potentielPlein,
} from './heures-types.js';
import { EPS } from './remplir.js';

// DISP-TOURS — CALCULER, PURE (Mariem's spec §1.5 step 4, R9–R11). The heavy part (the typical
// week → the dictionary → the file) runs ONCE per calculation; the cursor and the anti-miette
// only re-cut that file.
//   R10 — the MAXIMUM takes every usable heure-type of the pool, after removing the venues that
//         would not reach 30 DT even filled to 100 % (« exclu sous 30 DT même rempli »).
//         Maximum in DT = maximum impressions × CPM ÷ 1000 — not necessarily the old figure.
//   R9 — the PRICE is the exact sum of the allocated qualified impressions × CPM ÷ 1000: a passage
//        is indivisible, so it lands at or just under the targeted budget (149,90 DT for 150 DT),
//        never above it. The price of one impression does not change.
//   VÉRIFIER — three checks, each true or false (the admin journal shows them): the target is met
//        within one passage of the last tranche (unless the retained venues have no free hour
//        left), the price is the exact sum and never above the budget, no venue under 30 DT.

export interface CalculParams extends SeuilParams {
  t: number;
}

export type VenueStatut =
  /** Holds the campaign; at least one of its tranches is partial or not taken. */
  | 'retenu'
  /** Holds the campaign with every one of its tranches whole (no free hour left). */
  | 'plein'
  /** In the file, but the fill stopped before its first tranche. */
  | 'non_retenu'
  /** « Sous 30 DT au budget choisi » — removed by the anti-miette, its impressions refilled. */
  | 'retire_budget'
  /** « Sous 30 DT même rempli » — out of the file from the start. */
  | 'exclu_plein';

export interface VenueResultat {
  venueId: string;
  /** 1-based position in the pool order (SPS descending). */
  ordre: number;
  sps: number;
  pleinImpressions: number;
  pleinMontantTnd: number;
  impressions: number;
  montantTnd: number;
  statut: VenueStatut;
  /** The tranches it received, e.g. tour 1 (20 passages), tour 3 (11 passages). */
  tours: { tour: number; passages: number }[];
}

export interface Calcul {
  /** The dictionary D, per venue (ranked heures-types). */
  heures: Map<string, HeureType[]>;
  /** FILE — the tranche queue, the « exclu même rempli » venues left out. */
  file: Tranche[];
  final: RemplissageFinal;
  iMax: number;
  cMaxTnd: number;
  iCible: number;
  iAlloue: number;
  prixTnd: number;
  venues: VenueResultat[];
  verification: { objectif: boolean; prixExact: boolean; aucunSousSeuil: boolean };
}

/** The pool's dictionary, file and maximum — everything the cursor re-cuts. */
export interface PreCalcul {
  heures: Map<string, HeureType[]>;
  ordered: FileVenue[];
  exclusMax: Set<string>;
  file: Tranche[];
  iMax: number;
  cMaxTnd: number;
}

/** PRÉCALCUL — the dictionary, the « même rempli » exclusions, the file and the maximum. */
export const precalculer = (venues: readonly VenueInput[], params: CalculParams): PreCalcul => {
  const heures = new Map<string, HeureType[]>();
  const fileVenues: FileVenue[] = [];
  for (const venue of venues) {
    const ht = buildHeuresTypes(venue, params);
    if (ht.length === 0) continue; // no usable hour — not in the pool
    heures.set(venue.id, ht);
    fileVenues.push({ id: venue.id, sps: venue.sps, heures: ht });
  }
  const ordered = orderPool(fileVenues);
  const exclusMax = new Set(
    ordered.filter((v) => sousSeuil(potentielPlein(v.heures), params)).map((v) => v.id),
  );
  const file = buildFile(ordered.filter((v) => !exclusMax.has(v.id)));
  const iMax = file.at(-1)?.cum ?? 0;
  return { heures, ordered, exclusMax, file, iMax, cMaxTnd: (iMax * params.cpm) / 1000 };
};

/** REMPLIR + anti-miette + price + checks, on an already pre-computed pool (the cursor's path). */
export const couper = (pre: PreCalcul, budgetTnd: number, params: CalculParams): Calcul => {
  const iCible = Math.max(0, Math.min((budgetTnd * 1000) / params.cpm, pre.iMax));
  const final = remplirAvecSeuil(pre.file, iCible, params);
  const iAlloue = [...final.impressions.values()].reduce((sum, imp) => sum + imp, 0);
  const prixTnd = (iAlloue * params.cpm) / 1000;

  const retiresById = new Map(final.retires.map((r) => [r.venueId, r]));
  const takenWhole = new Set(final.file.slice(0, final.fill.cut).map((t) => t));
  const venues: VenueResultat[] = pre.ordered.map((v, i) => {
    const plein = potentielPlein(v.heures);
    const impressions = final.impressions.get(v.id) ?? 0;
    const own = final.file.filter((t) => t.venueId === v.id);
    const statut: VenueStatut = pre.exclusMax.has(v.id)
      ? 'exclu_plein'
      : retiresById.has(v.id)
        ? 'retire_budget'
        : impressions <= EPS
          ? 'non_retenu'
          : own.every((t) => takenWhole.has(t))
            ? 'plein'
            : 'retenu';
    return {
      venueId: v.id,
      ordre: i + 1,
      sps: v.sps,
      pleinImpressions: plein,
      pleinMontantTnd: montantSh(plein, params),
      impressions,
      montantTnd: montantSh(impressions, params),
      statut,
      tours: final.prises
        .filter((p) => p.tranche.venueId === v.id)
        .map((p) => ({ tour: p.tranche.tour, passages: p.passages })),
    };
  });

  // VÉRIFIER — the gap to the target stays under one passage of the cut tranche, unless the
  // retained venues have no free hour left (the fill took the whole kept file).
  const cutTranche = final.file[final.fill.cut];
  const libresEpuisees = cutTranche === undefined;
  const ecart = iCible - iAlloue;
  const objectif = ecart >= -EPS && (libresEpuisees || ecart < cutTranche.v / params.rPlein + EPS);
  const sumVenues = venues.reduce((sum, v) => sum + (v.impressions * params.cpm) / 1000, 0);
  const prixExact = Math.abs(sumVenues - prixTnd) < EPS && prixTnd <= budgetTnd + EPS;
  const aucunSousSeuil = venues.every(
    (v) => v.impressions <= EPS || !sousSeuil(v.impressions, params),
  );

  return {
    heures: pre.heures,
    file: pre.file,
    final,
    iMax: pre.iMax,
    cMaxTnd: pre.cMaxTnd,
    iCible,
    iAlloue,
    prixTnd,
    venues,
    verification: { objectif, prixExact, aucunSousSeuil },
  };
};

/** CALCULER(campagne, BUDGET) — the full calculation the cart runs at every opening. */
export const calculer = (
  venues: readonly VenueInput[],
  budgetTnd: number,
  params: CalculParams,
): Calcul => couper(precalculer(venues, params), budgetTnd, params);
