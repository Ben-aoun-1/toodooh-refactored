import { type HeureType } from './heures-types.js';

// DISP-TOURS — the FILE of tranches, PURE (Mariem's spec R6–R7).
//   R6 — a TRANCHE is, for one venue and one tour b, its heures-types of rang 2b-1 and 2b, for
//        each of the 7 weekdays (tour 1 = rangs 1 and 2, tour 2 = rangs 3 and 4…). The two hours of
//        a day need not be consecutive; a day with no hour at that rang simply adds nothing. Its
//        value V is the sum of its valeur_pleine.
//   R7 — the file lists every tranche of tour 1 (venues by SPS descending), then every tranche of
//        tour 2, and so on. A venue with no hour left at a tour is PLEIN: no tranche at that tour
//        nor any later one. CUM is the running total the fill and the cursor cut.

export interface Tranche {
  tour: number;
  venueId: string;
  heures: readonly HeureType[];
  /** Σ valeur_pleine of the tranche's heures-types. */
  v: number;
  /** Σ v from the head of the file through this tranche. */
  cum: number;
}

/** A pool venue with its ranked heures-types (heures-types.ts). */
export interface FileVenue {
  id: string;
  sps: number;
  heures: readonly HeureType[];
}

/** R1 — the pool order, used at every tour (fill and removal): SPS descending, id as the tiebreak. */
export const orderPool = <V extends { id: string; sps: number }>(venues: readonly V[]): V[] =>
  [...venues].sort((a, b) =>
    b.sps !== a.sps ? b.sps - a.sps : a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );

/** The running totals, recomputed on any (sub)sequence of tranches — FILE2 keeps FILE's order. */
export const withCumul = (tranches: readonly Omit<Tranche, 'cum'>[]): Tranche[] => {
  let cum = 0;
  return tranches.map((t) => {
    cum += t.v;
    return { ...t, cum };
  });
};

/** CONSTRUIRE_FILE — tour after tour over the pool in SPS order, until no venue has hours left. */
export const buildFile = (venues: readonly FileVenue[]): Tranche[] => {
  const ordered = orderPool(venues);
  const tranches: Omit<Tranche, 'cum'>[] = [];
  for (let tour = 1; ; tour += 1) {
    let any = false;
    for (const venue of ordered) {
      const heures = venue.heures
        .filter((h) => h.rang === 2 * tour - 1 || h.rang === 2 * tour)
        .sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.rang - b.rang);
      if (heures.length === 0) continue; // plein at this tour (and every later one)
      any = true;
      tranches.push({
        tour,
        venueId: venue.id,
        heures,
        v: heures.reduce((sum, h) => sum + h.valeurPleine, 0),
      });
    }
    if (!any) break;
  }
  return withCumul(tranches);
};
