import { HOUR_OPTIONS, isValidHoursWindow } from '@/features/auth/lib/working-hours';
import type { HoursPatch } from '@/features/screenhost/services/screenhost.service';

// H2 — the owner « Horaires d'ouverture » editor's pure logic + pinned French copy (no render
// harness). The window semantics are H1's single-window model ([open, close), ints 0–23, whole
// week — per-day/overnight deferred to L-disp); the selects reuse the H1 signup options and the
// H1 validity rule so signup and the editor can never drift.

export { HOUR_OPTIONS, isValidHoursWindow };

/** The card's window summary — « 08:00 – 22:00 », or null when no hours are set. */
export const hoursSummary = (opening: number | null, closing: number | null): string | null => {
  if (opening === null || closing === null) return null;
  const label = (h: number) => `${String(h).padStart(2, '0')}:00`;
  return `${label(opening)} – ${label(closing)}`;
};

// The honest no-hours state: what NULL columns actually mean for the venue.
export const NO_HOURS_LABEL = 'Aucun horaire défini';
export const NO_HOURS_EXPLANATION =
  'Sans horaires, la heatmap du rapport reste hachurée et le lieu est inéligible aux campagnes.';

// The order hint mirrors the API rule (open strictly before close).
export const HOURS_ORDER_HINT = "L'heure d'ouverture doit précéder l'heure de fermeture.";

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
