// DISP-TOURS (Mariem, « Toodooh : dispatching, pricing et redispatching des campagnes normales »,
// 03/11/2026) — the heure-type dictionary D, PURE. The engine reasons per HEURE-TYPE: one venue,
// one weekday, one clock hour (« Café A, lundi, 17 h »), covering EVERY date of that weekday in
// the period at once (the 4 Mondays of a campaign receive the same hours, together).
//
//   R3 — the usable dates of an hour are decided by the DB assembly (period, declared
//        unavailability, opening hours, CAP_heure, event reservations and match windows); n counts
//        them.
//   R4 — valeur_pleine = n × R_plein × A × T : the qualified impressions of the hour filled with
//        every possible passage on every usable date. Computed ONCE; every later figure (tranches,
//        cursor, price, venue amounts) is a sum of these values.
//   R5 — per venue and per weekday the heures-types rank by A descending (rang 1 = the busiest);
//        an equal A goes to the EARLIEST hour first.

/** One (weekday, hour) of a venue's typical week, with the dates it can air on for THIS campaign. */
export interface VenueHourInput {
  /** 1 = lundi … 7 = dimanche (getISODay — the affluence convention). */
  dayOfWeek: number;
  /** 0–23, the clock hour of the créneau (a post-midnight hour sits on its own calendar day). */
  hour: number;
  /** A — the typical-week affluence of that weekday and hour (whole people). */
  affluence: number;
  /** R3 — the usable calendar dates (Africa/Tunis, YYYY-MM-DD). */
  dates: readonly string[];
}

/** A venue of the pool, as the engine sees it. */
export interface VenueInput {
  id: string;
  /** The ordering key (R1 — SPS, the neutral midpoint for an unscored venue). */
  sps: number;
  hours: readonly VenueHourInput[];
}

export interface HeureType {
  venueId: string;
  dayOfWeek: number;
  hour: number;
  affluence: number;
  dates: readonly string[];
  /** R3 — the number of usable dates. */
  n: number;
  /** R4 — n × R_plein × A × T. */
  valeurPleine: number;
  /** R5 — 1 = the busiest hour of its weekday for this venue. */
  rang: number;
}

/** The engine parameters every heure-type is valued with (R_plein = ⌊F ÷ S⌋, T by spot length). */
export interface ValuationParams {
  rPlein: number;
  t: number;
}

/**
 * R3–R5 — one venue's heures-types, ranked inside each weekday. An hour with no usable date does
 * not exist for the campaign (« ni classée ni proposée ») — nor does an hour nobody attends: its
 * value is 0, so it could only take a place in the hour for no impression.
 */
export const buildHeuresTypes = (venue: VenueInput, params: ValuationParams): HeureType[] => {
  const byDay = new Map<number, Omit<HeureType, 'rang'>[]>();
  for (const h of venue.hours) {
    const n = new Set(h.dates).size;
    const valeurPleine = n * params.rPlein * h.affluence * params.t;
    if (n === 0 || valeurPleine <= 0) continue;
    const list = byDay.get(h.dayOfWeek) ?? [];
    list.push({
      venueId: venue.id,
      dayOfWeek: h.dayOfWeek,
      hour: h.hour,
      affluence: h.affluence,
      dates: [...new Set(h.dates)].sort(),
      n,
      valeurPleine,
    });
    byDay.set(h.dayOfWeek, list);
  }
  const ranked: HeureType[] = [];
  for (const day of [...byDay.keys()].sort((a, b) => a - b)) {
    const hours = (byDay.get(day) ?? []).sort((a, b) =>
      b.affluence !== a.affluence ? b.affluence - a.affluence : a.hour - b.hour,
    );
    hours.forEach((h, i) => ranked.push({ ...h, rang: i + 1 }));
  }
  return ranked;
};

/** PLEIN[h] — the venue's whole potential: every heure-type filled. */
export const potentielPlein = (heures: readonly HeureType[]): number =>
  heures.reduce((sum, h) => sum + h.valeurPleine, 0);
