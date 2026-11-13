// HOUR-UNAV1 (Mariem 26/10, operator rulings 2026-10-27) — the availability calendar BY THE HOUR,
// pure (no React; pinned in hour-unavailability.test.ts). Twin of the api's
// lib/unavailable-hours.ts cell model: a cell is a clock (date, hour); an overnight venue's
// post-midnight hours belong to its opening day but are DATED the next day. The owner and admin
// calendars both read their state through here.

/** The api's calendar read (owner and admin routes alike). */
export interface UnavailabilityView {
  /** Opening days that are WHOLLY unavailable. */
  days: string[];
  /** Every unavailable clock cell in range. */
  hours: { day: string; hour: number }[];
  opening_hour: number | null;
  closing_hour: number | null;
}

export type DayState = 'available' | 'partial' | 'unavailable';

const addDays = (iso: string, n: number): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** The window's clock hours in opening order, e.g. (20, 2) → [20, 21, 22, 23, 0, 1]; none → 0…23. */
export const windowHours = (opening: number | null, closing: number | null): number[] => {
  if (opening === null || closing === null || opening === closing) {
    return Array.from({ length: 24 }, (_, h) => h);
  }
  const span = (((closing - opening) % 24) + 24) % 24;
  return Array.from({ length: span }, (_, i) => (opening + i) % 24);
};

/** The calendar date an hour of opening day `day` falls on (overnight small hours → next day). */
export const cellDateOf = (day: string, hour: number, opening: number | null): string =>
  opening !== null && hour < opening ? addDays(day, 1) : day;

const keyOf = (date: string, hour: number): string => `${date}:${hour}`;

/** The unavailable hours of opening day `day`, in window order. */
export const unavailableHoursOf = (day: string, view: UnavailabilityView | undefined): number[] => {
  if (!view) return [];
  const cells = new Set(view.hours.map((c) => keyOf(c.day, c.hour)));
  return windowHours(view.opening_hour, view.closing_hour).filter((h) =>
    cells.has(keyOf(cellDateOf(day, h, view.opening_hour), h)),
  );
};

export const dayStateOf = (day: string, view: UnavailabilityView | undefined): DayState => {
  if (!view) return 'available';
  const off = unavailableHoursOf(day, view).length;
  if (off === 0) return 'available';
  return off === windowHours(view.opening_hour, view.closing_hour).length
    ? 'unavailable'
    : 'partial';
};

/** What « Enregistrer » sends: the hours to declare and those to free (window order). */
export const hoursChange = (
  before: readonly number[],
  after: readonly number[],
): { add: number[]; remove: number[] } => ({
  add: after.filter((h) => !before.includes(h)),
  remove: before.filter((h) => !after.includes(h)),
});

/** The optimistic cache step: the view after (un)declaring `hours` of `day` (null = whole day). */
export const applyHoursToggle = (
  view: UnavailabilityView,
  day: string,
  hours: readonly number[] | null,
  unavailable: boolean,
): UnavailabilityView => {
  const chosen = hours ?? windowHours(view.opening_hour, view.closing_hour);
  const target = chosen.map((h) => ({ day: cellDateOf(day, h, view.opening_hour), hour: h }));
  const rest = view.hours.filter((c) => !target.some((t) => t.day === c.day && t.hour === c.hour));
  const next = unavailable ? [...rest, ...target] : rest;
  const nextView = { ...view, hours: next };
  const whole = dayStateOf(day, nextView) === 'unavailable';
  return {
    ...nextView,
    days: whole ? [...new Set([...view.days, day])].sort() : view.days.filter((d) => d !== day),
  };
};

export const hourLabel = (h: number): string => `${h} h`;

/** « 14 h–16 h, 20 h–21 h » — consecutive window hours as ranges (end exclusive). */
export const hoursRangesLabel = (hours: readonly number[], window: readonly number[]): string => {
  const off = window.map((h) => hours.includes(h));
  const ranges: string[] = [];
  for (let i = 0; i < window.length; i += 1) {
    if (!off[i]) continue;
    let j = i;
    while (j + 1 < window.length && off[j + 1]) j += 1;
    ranges.push(`${window[i]} h–${((window[j] ?? 0) + 1) % 24} h`);
    i = j;
  }
  return ranges.join(', ');
};

export const ALL_DAY_LABEL = 'Toute la journée';
export const FREE_DAY_LABEL = 'Tout libérer';
export const HOURS_PANEL_HINT =
  'Touchez les heures où votre établissement ne pourra pas diffuser, puis enregistrez.';
