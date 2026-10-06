import type { EventItemView, MatchView, TeamView } from '../services/events.api';

// EVT-CAT2 (operator rulings 2026-10-06) — the new « Événements » page's pure rules, ONE home (the
// cards, the hero, « Ma sélection » and the tests read these). Youssef's validated design: « À la
// une » (one hero + pinned cards), then the matches month by month; a card names its teams, its
// competition/round, its date and its diffusion window; badges for what is not confirmed.

const TUNIS = 'Africa/Tunis';

/** The team shown when an opponent is not drawn yet. */
export const TBD_TEAM_NAME = 'Adversaire après tirage';
export const TBD_TEAM: TeamView = {
  id: 'tbd',
  name: TBD_TEAM_NAME,
  is_national: false,
  color_main: '#5A6B64',
  color_second: '#8FA39B',
  color_crowd: '#7E8F88',
  logo_url: null,
};

export const CARD_IMPRESSIONS_LABEL = "Maximum d'impressions potentielles";
export const SELECTION_IMPRESSIONS_LABEL = "Maximum d'impressions potentielles de la sélection";

/** « Mardi 3 novembre 2026 » — the kickoff day in Tunis, capitalised. */
export function longDate(iso: string): string {
  const s = new Date(iso).toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: TUNIS,
  });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** « 21h00 » in Tunis wall-clock. */
export function hourLabel(iso: string): string {
  return new Date(iso)
    .toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: TUNIS })
    .replace(':', 'h');
}

/** The card's date line: the admin's own wording when given, else the kickoff day. */
export function dateLine(e: EventItemView): string {
  return e.date_label?.trim() || longDate(e.kickoff_at);
}

/** « Coup d'envoi 21h00, diffusion de 20h00 à 0h00 » — or « à confirmer ». */
export function kickoffLine(e: EventItemView): string {
  if (e.time_tbc || e.date_tbc) return "Coup d'envoi à confirmer";
  const end = hourLabel(e.fenetre.window_end).replace(/^00h/, '0h');
  return `Coup d'envoi ${hourLabel(e.kickoff_at)}, diffusion de ${hourLabel(e.fenetre.window_start)} à ${end}`;
}

/** The poster's kickoff box: the hour, or « HORAIRE À CONFIRMER ». */
export function kickoffBadge(e: EventItemView): string | null {
  return e.time_tbc || e.date_tbc ? null : hourLabel(e.kickoff_at);
}

/** The badge under the date lines (one at most — the most blocking first). */
export function cardBadge(e: EventItemView): string | null {
  if (e.qualification_pending) return 'Sous réserve de qualification';
  if (e.date_tbc) return 'Jour à confirmer';
  if (e.time_tbc) return 'Horaire à confirmer';
  return null;
}

export const isMultiMatch = (e: EventItemView): boolean => (e.matches?.length ?? 0) > 1;

/** The card title: « Club Africain - Espérance de Tunis », or the evening, or the event name. */
export function cardTitle(e: EventItemView): string {
  const matches = e.matches ?? [];
  if (matches.length > 1) {
    return `${e.competition ? `Soirée ${e.competition}` : e.name}, ${matches.length} affiches au choix`;
  }
  const m = matches[0];
  if (m) return `${m.home.name} - ${(m.away ?? TBD_TEAM).name}`;
  return e.name;
}

/** The round line (« Ligue 1 tunisienne, 8ème journée »), falling back on the competition. */
export function roundLine(e: EventItemView): string | null {
  return e.round?.trim() || e.competition?.trim() || e.category?.trim() || null;
}

/** The crowd tint of a team in the stadium backdrop. */
export const crowdColor = (t: TeamView | null): string =>
  (t ?? TBD_TEAM).color_crowd ?? (t ?? TBD_TEAM).color_main;

/** The two colours of a selection row's swatch. */
export function swatch(e: EventItemView): [string, string] {
  const m = e.matches ?? [];
  if (m.length > 1) return ['#9195F8', '#76E6AB'];
  const first: MatchView | undefined = m[0];
  if (!first) return ['#0D2B1F', '#76E6AB'];
  return [crowdColor(first.home), crowdColor(first.away)];
}

export interface CatalogueMonth {
  key: string; // YYYY-MM (Tunis)
  label: string; // « Novembre 2026 »
  events: EventItemView[];
}

export interface CatalogueLayout {
  hero: EventItemView | null;
  pinned: EventItemView[];
  months: CatalogueMonth[];
}

const monthKey = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-CA', { timeZone: TUNIS }).slice(0, 7);

const monthLabel = (iso: string): string => {
  const s = new Date(iso).toLocaleDateString('fr-FR', {
    month: 'long',
    year: 'numeric',
    timeZone: TUNIS,
  });
  return s.charAt(0).toUpperCase() + s.slice(1);
};

/**
 * The page layout: the FIRST hero (by kickoff) is « À la une »'s big card — a second hero falls
 * back to pinned; pinned cards follow it; every other event lands in its Tunis kickoff month, in
 * kickoff order. The input order is not trusted.
 */
export function layoutCatalogue(list: readonly EventItemView[]): CatalogueLayout {
  const sorted = [...list].sort((a, b) => a.kickoff_at.localeCompare(b.kickoff_at));
  const hero = sorted.find((e) => e.featured === 'hero') ?? null;
  const pinned = sorted.filter((e) => e !== hero && e.featured != null);
  const rest = sorted.filter((e) => e !== hero && e.featured == null);
  const months: CatalogueMonth[] = [];
  for (const e of rest) {
    const key = monthKey(e.kickoff_at);
    let month = months.find((m) => m.key === key);
    if (!month) {
      month = { key, label: monthLabel(e.kickoff_at), events: [] };
      months.push(month);
    }
    month.events.push(e);
  }
  return { hero, pinned, months };
}

/** « 1 événement » / « 13 événements ». */
export const eventsCountLabel = (n: number): string => `${n} événement${n > 1 ? 's' : ''}`;

/** The selection CTA, by count. */
export function selectionCta(n: number): string {
  if (n > 1) return `Je me positionne sur ces ${n} événements`;
  if (n === 1) return 'Je me positionne sur cet événement';
  return 'Je me positionne';
}
