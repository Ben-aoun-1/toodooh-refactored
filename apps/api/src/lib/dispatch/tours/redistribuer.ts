import { type RemplissageFinal, remplirAvecSeuil } from './anti-miette.js';
import { type CalculParams } from './calculer.js';
import { buildFile } from './file.js';
import { type VenueInput, buildHeuresTypes } from './heures-types.js';
import {
  EPS,
  type Prise,
  impressionsParVenue,
  prisesCouvrantes,
  prisesDe,
  remplir,
} from './remplir.js';

// DISP-TOURS — REDISPATCH placement, PURE (Mariem's spec R14). A spot that did not air (screen
// off, outage…) is a loss valued on the FROZEN state (the missed créneaux' impressions); it is
// placed again with the same tour logic, on the REMAINING dates only (never after the campaign's
// end), and the defaulting venue never gets any of it back:
//   a. first onto the venues ALREADY holding the campaign (the defaulter excluded) that still
//      have free hours — hours this campaign does not use yet — by SPS then 2 peak hours. No
//      threshold here: they already hold at least 30 DT and only gain;
//   b. failing that, onto NEW eligible venues, each only if what it receives reaches 30 DT (the
//      R11 rule — a crumb's share is refilled onto the new venues kept, never onto a new one);
//   c. what could not be placed is refunded at the end of the campaign.
// The caller restricts every venue's hours to the remaining, free, still-usable dates.

export interface Redistribution {
  /** a. onto the venues already holding the campaign. */
  engages: { prises: Prise[]; impressions: Map<string, number> };
  /** b. onto new venues (anti-miette applied). */
  nouveaux: RemplissageFinal | null;
  place: number;
  /** c. refunded at the end of the campaign. */
  nonPlace: number;
}

/**
 * The order the loss is placed in. 'engages_dabord' — R14 above (during the campaign, and the
 * booster). Mariem 13/11 (« Notifications de campagne et redispatching avant le lancement »):
 * BEFORE the start, a share left by a refusal or a Host who did not answer goes FIRST to new
 * Hosts (same peaks, 30 DT each), the rest onto the Hosts that already accepted
 * ('nouveaux_dabord'); at the last redispatch (start − 5 min) no new Host could answer in time,
 * so only the accepted ones take it ('engages_seuls').
 *
 * Mariem 16/11 — a REFUSAL (a click) is not a silence: before the start, the refused share goes
 * at once onto the Hosts that ACCEPTED (« les établissements qui ont déjà la campagne »), new
 * Hosts only for what they cannot hold ('acceptes_dabord'). Only a Host silent at its start − 6 h
 * opens the campaign to new Hosts first ('nouveaux_dabord').
 */
export type OrdreRedistribution =
  | 'engages_dabord'
  | 'acceptes_dabord'
  | 'nouveaux_dabord'
  | 'engages_seuls';

export const redistribuer = (input: {
  perte: number;
  engages: readonly VenueInput[];
  nouveaux: readonly VenueInput[];
  params: CalculParams;
  ordre?: OrdreRedistribution;
  /**
   * Mariem 16/11 — a loss or a refused share is placed WHOLE (remplir.ts prisesCouvrantes).
   * false = R8's ⌊k⌋: the booster, a purchase priced to its budget, never exceeds it.
   */
  couvrant?: boolean;
}): Redistribution => {
  const { perte, params } = input;
  const ordre = input.ordre ?? 'engages_dabord';
  const couvrant = input.couvrant !== false;
  const toFileVenues = (venues: readonly VenueInput[]) =>
    venues.map((v) => ({ id: v.id, sps: v.sps, heures: buildHeuresTypes(v, params) }));
  const sumOf = (m: Map<string, number>) => [...m.values()].reduce((sum, imp) => sum + imp, 0);

  const surNouveaux = (volume: number): RemplissageFinal | null =>
    volume > EPS && input.nouveaux.length > 0 && ordre !== 'engages_seuls'
      ? remplirAvecSeuil(buildFile(toFileVenues(input.nouveaux)), volume, params, { couvrant })
      : null;
  const surEngages = (volume: number) => {
    if (volume <= EPS || input.engages.length === 0) {
      return { prises: [] as Prise[], impressions: new Map<string, number>() };
    }
    const fileA = buildFile(toFileVenues(input.engages));
    const fillA = remplir(fileA, volume, params.rPlein);
    // Mariem 16/11 — the share is placed whole (« couverture partielle… خصك الكل »).
    const prises = couvrant
      ? prisesCouvrantes(fileA, fillA, volume, params.rPlein)
      : prisesDe(fileA, fillA, params.rPlein);
    return { prises, impressions: impressionsParVenue(prises, params.rPlein) };
  };

  let nouveaux: RemplissageFinal | null = null;
  let engages: { prises: Prise[]; impressions: Map<string, number> };
  let reste = perte;
  if (ordre === 'nouveaux_dabord') {
    nouveaux = surNouveaux(reste);
    if (nouveaux) reste -= sumOf(nouveaux.impressions);
    engages = surEngages(reste);
    reste -= sumOf(engages.impressions);
  } else {
    engages = surEngages(reste);
    reste -= sumOf(engages.impressions);
    nouveaux = surNouveaux(reste);
    if (nouveaux) reste -= sumOf(nouveaux.impressions);
  }
  const nonPlace = Math.max(0, reste);
  return { engages, nouveaux, place: perte - nonPlace, nonPlace };
};
