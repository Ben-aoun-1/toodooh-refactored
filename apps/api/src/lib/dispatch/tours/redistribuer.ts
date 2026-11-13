import { type RemplissageFinal, remplirAvecSeuil } from './anti-miette.js';
import { type CalculParams } from './calculer.js';
import { buildFile } from './file.js';
import { type VenueInput, buildHeuresTypes } from './heures-types.js';
import { EPS, type Prise, impressionsParVenue, prisesDe, remplir } from './remplir.js';

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

export const redistribuer = (input: {
  perte: number;
  engages: readonly VenueInput[];
  nouveaux: readonly VenueInput[];
  params: CalculParams;
}): Redistribution => {
  const { perte, params } = input;
  const toFileVenues = (venues: readonly VenueInput[]) =>
    venues.map((v) => ({ id: v.id, sps: v.sps, heures: buildHeuresTypes(v, params) }));

  const fileA = buildFile(toFileVenues(input.engages));
  const fillA = remplir(fileA, perte, params.rPlein);
  const prisesA = prisesDe(fileA, fillA, params.rPlein);
  const impressionsA = impressionsParVenue(prisesA, params.rPlein);
  const placeA = [...impressionsA.values()].reduce((sum, imp) => sum + imp, 0);

  let reste = perte - placeA;
  let nouveaux: RemplissageFinal | null = null;
  if (reste > EPS && input.nouveaux.length > 0) {
    const fileB = buildFile(toFileVenues(input.nouveaux));
    nouveaux = remplirAvecSeuil(fileB, reste, params);
    reste -= [...nouveaux.impressions.values()].reduce((sum, imp) => sum + imp, 0);
  }
  const nonPlace = Math.max(0, reste);
  return {
    engages: { prises: prisesA, impressions: impressionsA },
    nouveaux,
    place: perte - nonPlace,
    nonPlace,
  };
};
