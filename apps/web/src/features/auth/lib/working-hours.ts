// H1 (Mejri item 5) — working hours captured at screenhost signup: ONE daily window
// [open, close), hour-granular ints 0–23, mirroring the screenhosts.opening_hour/closing_hour
// columns (the platform's single-window model; per-day stays deferred).
// HOURS-X1 (Mejri 09/09 point 4, ruling 2026-09-12): the window may CROSS MIDNIGHT — closing <
// opening means « closes the next day » (08 → 01 = 17 hours). Only an EQUAL pair is invalid. This
// file is the web TWIN of apps/api/src/lib/opening-hours.ts (no shared package); the fixtures in
// working-hours.test.ts mirror the api's opening-hours.test.ts — keep both lists identical.
// HOURS-M1 (Mejri 09/09, operator ruling 2026-09-12): the pair is MANDATORY — the former
// « préciser plus tard » skip is gone from the wizard and refused by the api for owners.

export const DEFAULT_OPENING_HOUR = 8;
export const DEFAULT_CLOSING_HOUR = 22;

/** The hour selects' options — 24 entries, '00:00' … '23:00' (no minutes: the store is ints). */
export const HOUR_OPTIONS = Array.from({ length: 24 }, (_, h) => ({
  value: h,
  label: `${String(h).padStart(2, '0')}:00`,
}));

/** Mirrors the API pair rule: ints 0–23, opening ≠ closing (an inverted pair wraps past midnight). */
export const isValidHoursWindow = (opening: number, closing: number): boolean =>
  Number.isInteger(opening) &&
  Number.isInteger(closing) &&
  opening >= 0 &&
  opening <= 23 &&
  closing >= 0 &&
  closing <= 23 &&
  opening !== closing;

/** Number of open hours on the clock: (closing − opening) mod 24; 0 when the pair is equal. */
export const hoursSpan = (opening: number, closing: number): number =>
  (((closing - opening) % 24) + 24) % 24;

/** The window closes on the NEXT calendar day. */
export const closesNextDay = (opening: number, closing: number): boolean => closing < opening;

/** Open hours in clock order, e.g. (8, 1) → [8 … 23, 0]. Empty when unset or zero-width. */
export const openingHoursList = (opening: number | null, closing: number | null): number[] => {
  if (opening === null || closing === null) return [];
  const span = hoursSpan(opening, closing);
  return Array.from({ length: span }, (_, i) => (opening + i) % 24);
};

/** Is the clock hour inside the (possibly wrapping) window? NULL bounds → false. */
export const isOpenAt = (hour: number, opening: number | null, closing: number | null): boolean => {
  if (opening === null || closing === null || opening === closing) return false;
  return opening < closing ? hour >= opening && hour < closing : hour >= opening || hour < closing;
};

/** The one wording for the zero-width pair (signup, settings editor, admin form). */
export const HOURS_DIFFER_ERROR =
  "L'heure d'ouverture et l'heure de fermeture doivent être différentes.";

/** The informational line under an overnight window, e.g. « Fermeture le lendemain — 17 h d'ouverture ». */
export const nextDayHint = (opening: number, closing: number): string | null =>
  closesNextDay(opening, closing)
    ? `Fermeture le lendemain — ${hoursSpan(opening, closing)} h d'ouverture.`
    : null;

export interface HoursPayload {
  opening_hour: number;
  closing_hour: number;
}

/** Always the full pair (HOURS-M1 — there is no skip any more). */
export const hoursPayload = (opening: number, closing: number): HoursPayload => ({
  opening_hour: opening,
  closing_hour: closing,
});
