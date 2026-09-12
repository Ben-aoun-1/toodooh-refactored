import {
  HOURS_DIFFER_ERROR,
  HOUR_OPTIONS,
  closesNextDay,
  isValidHoursWindow,
  nextDayHint,
} from '@/features/auth/lib/working-hours';
import type { HoursPatch } from '@/features/screenhost/services/screenhost.service';

// H2 — the owner « Horaires d'ouverture » editor's pure logic + pinned French copy (no render
// harness). The window semantics are H1's single-window model ([open, close), ints 0–23, whole
// week — per-day/overnight deferred to L-disp); the selects reuse the H1 signup options and the
// H1 validity rule so signup and the editor can never drift.

export { HOUR_OPTIONS, isValidHoursWindow, nextDayHint };

/** The card's window summary — « 08:00 – 22:00 », « 08:00 – 01:00 (lendemain) » across midnight
 * (HOURS-X1), or null when no hours are set. */
export const hoursSummary = (opening: number | null, closing: number | null): string | null => {
  if (opening === null || closing === null) return null;
  const label = (h: number) => `${String(h).padStart(2, '0')}:00`;
  return `${label(opening)} – ${label(closing)}${closesNextDay(opening, closing) ? ' (lendemain)' : ''}`;
};

// The honest no-hours state: what NULL columns actually mean for the venue.
export const NO_HOURS_LABEL = 'Aucun horaire défini';
export const NO_HOURS_EXPLANATION =
  'Sans horaires, la heatmap du rapport reste hachurée et le lieu est inéligible aux campagnes.';

// HOURS-X1: the API refuses only an EQUAL pair (an inverted one closes the next day) — the hint
// keeps its name (three consumers) and takes the shared wording.
export const HOURS_ORDER_HINT = HOURS_DIFFER_ERROR;

// Clearing is consequential — the confirm repeats the consequence (the app's window.confirm idiom).
export const DELETE_HOURS_CONFIRM =
  'Supprimer les horaires ? Le lieu redeviendra inéligible aux campagnes et sa heatmap restera hachurée.';

export const HOURS_SAVED_TOAST = 'Horaires enregistrés';
export const HOURS_CLEARED_TOAST = 'Horaires supprimés';
export const HOURS_ERROR_TOAST = "Impossible d'enregistrer les horaires";

/** The save PATCH body — the full pair (validated by isValidHoursWindow before calling). */
export const saveHoursPatch = (opening: number, closing: number): HoursPatch => ({
  opening_hour: opening,
  closing_hour: closing,
});

/** The clear PATCH body — BOTH null (the API's clears-to-no-hours contract). */
export const clearHoursPatch = (): HoursPatch => ({ opening_hour: null, closing_hour: null });
