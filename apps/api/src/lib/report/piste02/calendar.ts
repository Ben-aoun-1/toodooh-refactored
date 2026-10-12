/**
 * PISTES-V2 — the spec's `contexte_calendaire` (docs/specs/piste-02-angles-morts.md §2).
 *
 * Ramadan comes from a static table of the Tunisian dates (the first and last fasting day). They
 * are set each year by moon sighting, so a boundary can move by a day; the flag only needs to
 * know whether the month OVERLAPS the fast, which a one-day shift does not change. Extend the table
 * each year. School holidays are not known to the platform yet: `vacances_scolaires` is null
 * (unknown), never a guessed false (operator ruling 2026-10-12).
 */

const RAMADAN: readonly { first: string; last: string }[] = [
  { first: '2026-02-18', last: '2026-03-19' },
  { first: '2027-02-08', last: '2027-03-09' },
];

export type Saison = 'hiver' | 'printemps' | 'ete' | 'automne';

export interface ContexteCalendaire {
  ramadan: boolean;
  vacances_scolaires: boolean | null;
  saison: Saison;
  evenements_locaux_majeurs: string[];
}

/** Whether [from, to] (YYYY-MM-DD, inclusive) overlaps a Ramadan of the table. */
export const overlapsRamadan = (from: string, to: string): boolean =>
  RAMADAN.some((r) => from <= r.last && to >= r.first);

/** Meteorological seasons of the northern hemisphere, by the period's month (YYYY-MM-…). */
export const saisonOf = (dayIso: string): Saison => {
  const month = Number(dayIso.slice(5, 7));
  if (month === 12 || month <= 2) return 'hiver';
  if (month <= 5) return 'printemps';
  if (month <= 8) return 'ete';
  return 'automne';
};

export const contexteCalendaire = (from: string, to: string): ContexteCalendaire => ({
  ramadan: overlapsRamadan(from, to),
  vacances_scolaires: null,
  saison: saisonOf(from),
  evenements_locaux_majeurs: [],
});
