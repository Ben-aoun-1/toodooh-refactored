import { isValidHoursWindow } from './working-hours';

// Mariem 11/11 (test feedback, « Inscription du host ») — two facts the Host declares next to its
// opening hours: the Ramadan window (same single-window model: ints 0–23, closing < opening =
// closes the next day) and « Diffusez-vous les matchs ? » (Oui / Non). The wizard requires both;
// the api stores them as declarations only (nothing in dispatch or pricing reads them yet). Twin of
// apps/api/src/validation/signup-venue.ts (ramadanIsPaired / ramadanIsOrdered).

/** Prefill of the Ramadan selects: the evening after iftar, closing past midnight. */
export const DEFAULT_RAMADAN_OPENING_HOUR = 20;
export const DEFAULT_RAMADAN_CLOSING_HOUR = 2;

export const BROADCASTS_MATCHES_QUESTION = 'Diffusez-vous les matchs ?';
export const BROADCASTS_MATCHES_REQUIRED_ERROR = 'Indiquez si vous diffusez les matchs.';
export const RAMADAN_HOURS_ERROR =
  "Pendant le Ramadan, l'heure d'ouverture et l'heure de fermeture doivent être différentes.";

export interface VenueDeclarations {
  ramadanOpening: number;
  ramadanClosing: number;
  /** null = not answered yet. */
  broadcastsMatches: boolean | null;
}

export interface VenueDeclarationsPayload {
  ramadan_opening_hour: number;
  ramadan_closing_hour: number;
  broadcasts_matches: boolean;
}

/** The step's two messages, keyed like the signup field errors (empty = valid). */
export const venueDeclarationErrors = (d: VenueDeclarations): Record<string, string> => {
  const errors: Record<string, string> = {};
  if (!isValidHoursWindow(d.ramadanOpening, d.ramadanClosing))
    errors['ramadanHours'] = RAMADAN_HOURS_ERROR;
  if (d.broadcastsMatches === null) errors['broadcastsMatches'] = BROADCASTS_MATCHES_REQUIRED_ERROR;
  return errors;
};

export const isValidVenueDeclarations = (d: VenueDeclarations): boolean =>
  Object.keys(venueDeclarationErrors(d)).length === 0;

/** The wire fields — only for a valid declaration (callers gate on isValidVenueDeclarations). */
export const venueDeclarationsPayload = (d: VenueDeclarations): VenueDeclarationsPayload => ({
  ramadan_opening_hour: d.ramadanOpening,
  ramadan_closing_hour: d.ramadanClosing,
  broadcasts_matches: d.broadcastsMatches === true,
});

export const initialVenueDeclarations = (): VenueDeclarations => ({
  ramadanOpening: DEFAULT_RAMADAN_OPENING_HOUR,
  ramadanClosing: DEFAULT_RAMADAN_CLOSING_HOUR,
  broadcastsMatches: null,
});
