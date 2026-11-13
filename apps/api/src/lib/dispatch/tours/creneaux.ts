import { type DispatchCreneau } from '../../../db/schema.js';

import { type Prise } from './remplir.js';

// DISP-TOURS — from the taken tranches to the créneaux an allocation stores, PURE. One créneau per
// usable DATE of every heure-type taken: the hour, its passages (R_plein, or the partial
// tranche's k — the same k on every hour and date of it, R8) and its PHYSICAL impressions
// A × passages (the unit settlement and the missed-slot detector read; qualified = × T). `tour`
// rides along for the admin's week grid. Nothing else airs: a venue's other hours carry no
// créneau, so the playlist blacks them out (lib/playout).

export type TourCreneau = DispatchCreneau & { tour: number };

/** The créneaux of one venue's taken tranches, by date then hour. */
export const creneauxDe = (prises: readonly Prise[]): TourCreneau[] => {
  const creneaux: TourCreneau[] = [];
  for (const prise of prises) {
    for (const h of prise.tranche.heures) {
      for (const date of h.dates) {
        creneaux.push({
          date,
          hour: h.hour,
          reps: prise.passages,
          impressions: h.affluence * prise.passages,
          tour: prise.tranche.tour,
        });
      }
    }
  }
  return creneaux.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.hour - b.hour));
};

/** The créneaux per venue, for every venue a fill retained. */
export const creneauxParVenue = (prises: readonly Prise[]): Map<string, TourCreneau[]> => {
  const byVenue = new Map<string, Prise[]>();
  for (const p of prises) {
    const list = byVenue.get(p.tranche.venueId) ?? [];
    list.push(p);
    byVenue.set(p.tranche.venueId, list);
  }
  return new Map([...byVenue].map(([venueId, list]) => [venueId, creneauxDe(list)]));
};
