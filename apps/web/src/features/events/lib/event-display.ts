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
/** The same button on a match that is over or annulé. */
export const CLOSED_CTA = 'Positionnement clos';

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

// Operator 23/11/2026 — a match still « à confirmer » is sold like any other: its kickoff_at is a
// PROVISIONAL instant, so no screen prints it as a fact. ONE home for what stands in its place.
type ConfirmationFlags = { date_tbc?: boolean; time_tbc?: boolean };

/** The match's day or kick-off time is not confirmed yet. */
export const isUnconfirmed = (e: ConfirmationFlags): boolean =>
  e.date_tbc === true || e.time_tbc === true;

export const DATE_TBC_LABEL = 'Date à confirmer';
export const HOURS_TBC_LABEL = 'Horaire à confirmer';

/** What the Screencaster reads before buying a match whose day or time is not confirmed. */
export const UNCONFIRMED_NOTE =
  'La date ou l’horaire de ce match reste à confirmer. Vos créneaux se placeront automatiquement sur la fenêtre de diffusion dès la confirmation, sans action de votre part.';

/** The match's day, or « Date à confirmer ». */
export function eventDateText(e: ConfirmationFlags & { kickoff_at: string }): string {
  return e.date_tbc === true ? DATE_TBC_LABEL : formatEventDate(e.kickoff_at);
}

/** An interval of the match in Tunis hours, or « Horaire à confirmer ». */
export function eventHoursText(e: ConfirmationFlags, startIso: string, endIso: string): string {
  return isUnconfirmed(e) ? HOURS_TBC_LABEL : formatEventHours(startIso, endIso);
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
