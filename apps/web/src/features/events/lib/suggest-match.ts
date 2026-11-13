import type { EventItemView } from '../services/events.api';

import { formatEventDate } from './event-display';

// SUGG-2 (Youssef's « Événements » v9 mockup, rulings A A A 2026-10-26) — « Suggérer un match » is
// a window opened from the top of the Football page (and from an empty search). Its CTA
// « Je me positionne → » records the suggestion AND opens the positioning on it at once. When the
// match already exists (suggested or official) the api names it, and the screencaster is
// positioned on THAT match instead of being stopped. The copy lives here, once.

export const SUGGEST_CTA = 'Suggérer un match';
export const SUGGEST_EYEBROW = 'Suggérer un match';
export const SUGGEST_TITLE = 'Proposez votre affiche';
export const SUGGEST_INTRO_BEFORE =
  'Indiquez les deux équipes, la date exacte et l’horaire du coup d’envoi. Une fois l’affiche identifiée et votre campagne lancée, nous consultons les Screenhosts du réseau pour qu’ils ';
export const SUGGEST_INTRO_BOLD = 's’engagent à diffuser votre affiche dans leur établissement';
export const SUGGEST_INTRO_AFTER =
  ' — afin de vous garantir la visibilité souhaitée pendant le match.';
export const SUGGEST_WINDOW_NOTE =
  'La fenêtre de diffusion sera calculée automatiquement : 1 h avant · match · 1 h après.';
export const SUGGEST_SUBMIT = 'Je me positionne';
export const SUGGEST_CANCEL = 'Annuler';
export const SUGGEST_EMPTY_SEARCH_BEFORE =
  'Aucun match ne correspond à votre recherche. Vous pouvez le ';
export const SUGGEST_EMPTY_SEARCH_LINK = 'suggérer';

/** The badge on the positioning header of a suggested match. */
export const SUGGESTED_MATCH_BADGE = 'Match suggéré';

/** The toast when the match already existed and the positioning went to it. */
export const EXISTING_MATCH_TOAST = 'Ce match existe déjà — vous vous positionnez dessus.';

/**
 * The 409 « already exists » refusal names its twin (`existing_event_id`); anything else — a
 * different error, a missing or malformed field — is null (the caller then shows the message).
 */
export function existingEventIdOf(body: unknown): string | null {
  if (typeof body !== 'object' || body === null || !('existing_event_id' in body)) return null;
  const id = body.existing_event_id;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

/** « Période définie par vous : 20 novembre 2026 · 20h00 (heure de Tunis) ». */
export function suggestedPeriodLine(event: Pick<EventItemView, 'kickoff_at'>): string {
  const time = new Date(event.kickoff_at)
    .toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Tunis' })
    .replace(':', 'h');
  return `Période définie par vous : ${formatEventDate(event.kickoff_at)} · ${time} (heure de Tunis)`;
}
