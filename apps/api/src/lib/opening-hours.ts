// HOURS-X1 (Mejri 09/09 point 4 + 11/09 point 3, operator ruling 2026-09-12) — the ONE place that
// turns a venue's (opening_hour, closing_hour) pair into its list of open hours, WRAP INCLUDED.
//
// Model: ints 0–23, the window is [opening, closing) on the clock. closing ≤ opening no longer
// means « invalid »: closing < opening means the venue closes the NEXT day (08 → 01 = 08h…23h then
// 00h — 17 hours). opening === closing is the only degenerate pair (zero-width) and stays refused
// by every writer. NULL on either side = « no hours » (legacy rows; the wizard requires the pair
// since HOURS-M1). Every consumer that iterates hours goes through here — the web carries a twin
// (apps/web/src/features/auth/lib/working-hours.ts) kept in sync by pinned fixtures.

/** Number of open hours on the clock: (closing − opening) mod 24; 0 when the pair is equal. */
export const hoursSpan = (openingHour: number, closingHour: number): number =>
  (((closingHour - openingHour) % 24) + 24) % 24;

/** Open hours in clock order, e.g. (8, 1) → [8 … 23, 0]. Empty when unset or zero-width. */
export const broadcastableHours = (
  openingHour: number | null,
  closingHour: number | null,
): number[] => {
  if (openingHour === null || closingHour === null) return [];
  const span = hoursSpan(openingHour, closingHour);
  const hours: number[] = [];
  for (let i = 0; i < span; i += 1) hours.push((openingHour + i) % 24);
  return hours;
};

/** One open hour with the calendar-day shift it lives on: 0 = the opening day, 1 = the next day. */
export interface OpeningHour {
  hour: number;
  dayOffset: 0 | 1;
}

/** The same list, each hour tagged with the day it falls on (post-midnight hours → next day). */
export const openingHours = (
  openingHour: number | null,
  closingHour: number | null,
): OpeningHour[] =>
  broadcastableHours(openingHour, closingHour).map((hour) => ({
    hour,
    dayOffset: openingHour !== null && hour < openingHour ? 1 : 0,
  }));

/** Is the clock hour inside the (possibly wrapping) window? NULL bounds → false. */
export const isOpenAt = (
  hour: number,
  openingHour: number | null,
  closingHour: number | null,
): boolean => {
  if (openingHour === null || closingHour === null) return false;
  if (openingHour === closingHour) return false;
  return openingHour < closingHour
    ? hour >= openingHour && hour < closingHour
    : hour >= openingHour || hour < closingHour;
};

/** ISO YYYY-MM-DD + n days, calendar arithmetic (no timezone involved). */
export const addIsoDays = (isoDate: string, days: number): string => {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
};

/** Weekday 1=Mon … 7=Sun shifted by a day offset. */
export const shiftDayOfWeek = (dayOfWeek: number, dayOffset: number): number =>
  ((dayOfWeek - 1 + dayOffset) % 7) + 1;
