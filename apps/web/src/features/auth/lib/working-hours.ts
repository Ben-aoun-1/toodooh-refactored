// H1 (Mejri item 5) — working hours captured at screenhost signup: ONE daily window
// [open, close), hour-granular ints 0–23, mirroring the screenhosts.opening_hour/closing_hour
// columns (the platform's single-window model; per-day + overnight stay deferred to L-disp).
// HOURS-M1 (Mejri 09/09, operator ruling 2026-09-12): the pair is MANDATORY — the former
// « préciser plus tard » skip is gone from the wizard and refused by the api for owners.

export const DEFAULT_OPENING_HOUR = 8;
export const DEFAULT_CLOSING_HOUR = 22;

/** The hour selects' options — 24 entries, '00:00' … '23:00' (no minutes: the store is ints). */
export const HOUR_OPTIONS = Array.from({ length: 24 }, (_, h) => ({
  value: h,
  label: `${String(h).padStart(2, '0')}:00`,
}));

/** Mirrors the API pair rule (ints 0–23, open < close — the DB checks + [open, close) reading). */
export const isValidHoursWindow = (opening: number, closing: number): boolean =>
  Number.isInteger(opening) &&
  Number.isInteger(closing) &&
  opening >= 0 &&
  opening <= 23 &&
  closing >= 0 &&
  closing <= 23 &&
  opening < closing;

export interface HoursPayload {
  opening_hour: number;
  closing_hour: number;
}

/** Always the full pair (HOURS-M1 — there is no skip any more). */
export const hoursPayload = (opening: number, closing: number): HoursPayload => ({
  opening_hour: opening,
  closing_hour: closing,
});
