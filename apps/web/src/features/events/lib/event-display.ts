import type { EventItemView, SuggestMatchInput } from '../services/events.api';

// EV1 — the pure display + validation rules of the Événements surface, ONE home (the cards, the
// suggest form and the tests all read these — no duplicated literals in components).

/** The derived-status chips (the api derives `statut`; the web only labels it). */
export const STATUT_LABELS: Record<EventItemView['statut'], string> = {
  a_venir: 'À venir',
  en_cours: 'En cours',
  termine: 'Terminé',
};

export const STATUT_CHIP_CLASSES: Record<EventItemView['statut'], string> = {
  a_venir: 'bg-blue-50 text-blue-700',
  en_cours: 'bg-brand-primary/10 text-brand-deep',
  termine: 'bg-gray-100 text-gray-600',
};

/** The window line under every card — the ± 1 h contract, spelled once. */
export const WINDOW_LINE = 'Diffusion : 1 h avant · match · 1 h après';

/** The badge on suggested cards. */
export const SUGGESTED_BADGE = 'Suggéré par un annonceur';

/** The positioning CTA — LIVE since EV3 (the « Bientôt disponible » placeholder retired). */
export const POSITIONNE_CTA = 'Je me positionne';

const TUNIS = 'Africa/Tunis';

/** « 12 mars 2027 » — the kickoff calendar date in Tunis. */
export function formatEventDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: TUNIS,
  });
}

/** « 20h00 - 22h30 » — the match interval in Tunis wall-clock. */
export function formatEventHours(kickoffIso: string, endsIso: string): string {
  const fmt = (iso: string) =>
    new Date(iso)
      .toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: TUNIS })
      .replace(':', 'h');
  return `${fmt(kickoffIso)} - ${fmt(endsIso)}`;
}

/** Search by équipe/phase: a case-insensitive substring match on the name OR the catégorie. */
export function searchEvents(list: EventItemView[], query: string): EventItemView[] {
  const q = query.trim().toLowerCase();
  if (q === '') return list;
  return list.filter(
    (e) => e.name.toLowerCase().includes(q) || (e.category ?? '').toLowerCase().includes(q),
  );
}

export type SuggestFormErrors = Partial<Record<keyof SuggestMatchInput, string>>;

/** The client-side mirror of the server's per-field requirements (same French messages). */
export function validateSuggestForm(input: SuggestMatchInput): SuggestFormErrors {
  const errors: SuggestFormErrors = {};
  if (input.team_a.trim() === '') errors.team_a = "L'équipe A est obligatoire.";
  if (input.team_b.trim() === '') errors.team_b = "L'équipe B est obligatoire.";
  if (input.date.trim() === '') errors.date = 'La date du match est obligatoire.';
  if (input.kickoff_time.trim() === '') errors.kickoff_time = "L'horaire du match est obligatoire.";
  return errors;
}
