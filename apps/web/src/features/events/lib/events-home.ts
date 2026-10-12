import type { EventItemView } from '../services/events.api';

/**
 * The Événements home (Youssef's « Toodooh Page événements.html », operator rulings 2026-10-12:
 * Q1 A the doors home + one page per universe, Q2 A Toodooh fonts, Q3 A « Mes Événements » under
 * the doors and the suggestions under the football catalogue, Q4 A the Ramadan card hides its
 * impressions while it is coming soon). ONE home for the paths, the Ramadan copy (verbatim from
 * the design) and the football door's live figures — the components only render these.
 */

export const EVENTS_PATHS = {
  home: '/evenements',
  football: '/evenements/football',
  ramadan: '/evenements/ramadan',
} as const;

/** The browse pages of the Événements section (sidebar entry active, the section's header). */
export const isEventsBrowsePath = (pathname: string): boolean =>
  (Object.values(EVENTS_PATHS) as string[]).includes(pathname);

export const EVENTS_CRUMB_LABEL = 'Tous les événements';

/** « Bientôt disponible » — the Ramadan offer is shown, not sold yet (operator 2026-10-12). */
export const COMING_SOON_LABEL = 'Bientôt disponible';

/** The Ramadan 2027 offer, verbatim from the design. */
export const RAMADAN_OFFER = {
  arabic: 'رمضان كريم',
  title: 'Ramadan',
  year: '2027',
  chip: 'Événement saisonnier',
  pitch:
    'Après les feuilletons, les cafés se remplissent et la soirée commence. Votre marque y est présente chaque soir, jusqu’au shour.',
  nights: 29,
  window: { from: '22h00', to: '4h00' },
  shortRange: 'Du 8 février au 8 mars 2027',
  sectionTitle: 'Ramadan 2027',
  cardTitle: 'Soirées du Ramadan 2027',
  cardRound: 'Événement saisonnier, 29 soirées',
  cardDates: 'Du lundi 8 février au lundi 8 mars 2027',
  cardWindow: 'Diffusion chaque soir de 22h00 à 4h00',
  cardBadge: 'Dates sous réserve de l’observation du croissant lunaire',
  doorCta: 'Voir l’offre Ramadan',
} as const;

const TUNIS = 'Africa/Tunis';

/** « 15 nov. » — a fixture's short date (Tunis), as the football door prints it. */
export const shortFixtureDate = (iso: string): string =>
  new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', timeZone: TUNIS });

const monthOf = (iso: string): { name: string; year: string } => {
  const d = new Date(iso);
  return {
    name: d.toLocaleDateString('fr-FR', { month: 'long', timeZone: TUNIS }),
    year: d.toLocaleDateString('fr-FR', { year: 'numeric', timeZone: TUNIS }),
  };
};

/** « octobre, novembre et décembre 2026 » — the catalogue's months, in order. */
export function monthsSpanLabel(isoDates: readonly string[]): string {
  const months: { name: string; year: string }[] = [];
  for (const iso of [...isoDates].sort()) {
    const m = monthOf(iso);
    if (!months.some((x) => x.name === m.name && x.year === m.year)) months.push(m);
  }
  if (months.length === 0) return '';
  const sameYear = months.every((m) => m.year === months[0]?.year);
  const names = months.map((m) => (sameYear ? m.name : `${m.name} ${m.year}`));
  const joined =
    names.length === 1
      ? names[0]
      : `${names.slice(0, -1).join(', ')} et ${names[names.length - 1]}`;
  return sameYear ? `${joined} ${months[0]?.year ?? ''}` : (joined ?? '');
}

export interface FootballDoorData {
  /** « 24 affiches, novembre et décembre 2026 » — null when the catalogue is empty. */
  kicker: string | null;
  /** Up to three fixtures: the featured ones first, then the soonest. */
  fixtures: { id: string; name: string; date: string }[];
}

/** The football door's live figures, from the official catalogue. */
export function footballDoorData(catalogue: readonly EventItemView[]): FootballDoorData {
  const official = catalogue.filter((e) => e.source === 'official');
  if (official.length === 0) return { kicker: null, fixtures: [] };
  const byKickoff = [...official].sort((a, b) => a.kickoff_at.localeCompare(b.kickoff_at));
  const rank = (e: EventItemView): number =>
    e.featured === 'hero' ? 0 : e.featured === 'pinned' ? 1 : 2;
  const picked = [...byKickoff].sort((a, b) => rank(a) - rank(b)).slice(0, 3);
  const fixtures = byKickoff
    .filter((e) => picked.includes(e))
    .map((e) => ({
      id: e.id,
      name: e.name,
      date: e.date_tbc ? 'à confirmer' : shortFixtureDate(e.kickoff_at),
    }));
  const count = `${official.length} affiche${official.length > 1 ? 's' : ''}`;
  return {
    kicker: `${count}, ${monthsSpanLabel(official.map((e) => e.kickoff_at))}`,
    fixtures,
  };
}
