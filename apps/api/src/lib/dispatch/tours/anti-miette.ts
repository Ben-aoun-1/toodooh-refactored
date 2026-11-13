import { type Tranche, withCumul } from './file.js';
import {
  EPS,
  type Prise,
  type Remplissage,
  impressionsParVenue,
  prisesDe,
  remplir,
} from './remplir.js';

// DISP-TOURS — the 30 DT anti-miette, PURE (Mariem's spec R9, R11).
//   R9 — a venue's AMOUNT (the one its notification shows) is its own qualified impressions × CPM
//        ÷ 1000 × the Screenhost share set in the Admin.
//   R11 — no venue receives a campaign worth less than SEUIL_SH = 30 DT to it, for the WHOLE
//        campaign. At each calculation, a venue the fill leaves under it is removed; its
//        impressions go to the venues that ALREADY hold the campaign and still have free hours, in
//        the same order (tour, then SPS, by 2 peak hours) — FILE2, FILE without the crumbs, refilled
//        to the same target. No new venue is ever added to compensate: when the retained venues
//        run out of hours, the campaign's impressions and price simply go down. The retained venues
//        only ever gain impressions, so none of them can fall under the threshold after it.

/** What a venue's share is computed from. */
export interface MontantParams {
  cpm: number;
  /** The Screenhost share of the reversement split, in percent (dispatch_config.pct_sh). */
  pctSh: number;
}

export interface SeuilParams extends MontantParams {
  rPlein: number;
  /** SEUIL_SH — the minimum a venue sees for the whole campaign (30 DT). */
  seuilShTnd: number;
}

/** MONTANT(impressions) = impressions × CPM ÷ 1000 × part Screenhost. */
export const montantSh = (impressions: number, params: MontantParams): number =>
  ((impressions * params.cpm) / 1000) * (params.pctSh / 100);

/** Strictly under the threshold (a venue worth exactly 30 DT is kept). */
export const sousSeuil = (impressions: number, params: SeuilParams): boolean =>
  montantSh(impressions, params) < params.seuilShTnd - EPS;

export interface RetraitMiette {
  venueId: string;
  /** What the first fill gave it, before the removal. */
  impressions: number;
  montantTnd: number;
}

export interface RemplissageFinal {
  /** The file the kept fill ran on: the input file, or FILE2 without the crumbs. */
  file: Tranche[];
  fill: Remplissage;
  prises: Prise[];
  /** Σ qualified impressions per retained venue. */
  impressions: Map<string, number>;
  /** The venues removed under the threshold at this target (« sous 30 DT au budget choisi »). */
  retires: RetraitMiette[];
}

/** REMPLIR, then the anti-miette: a crumb's impressions are refilled onto the retained venues. */
export const remplirAvecSeuil = (
  file: readonly Tranche[],
  iCible: number,
  params: SeuilParams,
): RemplissageFinal => {
  const fill = remplir(file, iCible, params.rPlein);
  const prises = prisesDe(file, fill, params.rPlein);
  const impressions = impressionsParVenue(prises, params.rPlein);
  const retires: RetraitMiette[] = [...impressions]
    .filter(([, imp]) => sousSeuil(imp, params))
    .map(([venueId, imp]) => ({ venueId, impressions: imp, montantTnd: montantSh(imp, params) }));
  if (retires.length === 0) return { file: [...file], fill, prises, impressions, retires };

  const removed = new Set(retires.map((r) => r.venueId));
  const engages = new Set([...impressions.keys()].filter((id) => !removed.has(id)));
  // FILE2 — FILE's tranches of the venues that keep the campaign, order conserved.
  const file2 = withCumul(
    file
      .filter((t) => engages.has(t.venueId))
      .map(({ tour, venueId, heures, v }) => ({ tour, venueId, heures, v })),
  );
  const fill2 = remplir(file2, iCible, params.rPlein); // FILE2 too short = all of FILE2
  const prises2 = prisesDe(file2, fill2, params.rPlein);
  return {
    file: file2,
    fill: fill2,
    prises: prises2,
    impressions: impressionsParVenue(prises2, params.rPlein),
    retires,
  };
};
