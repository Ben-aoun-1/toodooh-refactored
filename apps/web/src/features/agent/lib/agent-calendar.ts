// AGENT-VF (spec VF « Mon calendrier ») — the rules of the multi-day availability editor, pure.

export const CAL_HOURS: readonly number[] = Array.from({ length: 24 }, (_, h) => h);

export interface CalendarBlocks {
  /** Days blocked whole. */
  unavailable: readonly string[];
  /** Single blocked hours of the other days. */
  unavailable_hours: readonly { day: string; hour: number }[];
}

const isBlocked = (view: CalendarBlocks, day: string, hour: number): boolean =>
  view.unavailable.includes(day) ||
  view.unavailable_hours.some((u) => u.day === day && u.hour === hour);

/**
 * The state of one hour chip over the selected days: 'off' when the hour is blocked on every
 * selected day, 'mix' on some of them only, 'free' on none.
 */
export function hourChipState(
  view: CalendarBlocks,
  selected: readonly string[],
  hour: number,
): 'off' | 'mix' | 'free' {
  const n = selected.filter((d) => isBlocked(view, d, hour)).length;
  if (selected.length > 0 && n === selected.length) return 'off';
  return n > 0 ? 'mix' : 'free';
}

/**
 * A touch on an hour chip: blocked everywhere → the hour is freed on every selected day;
 * otherwise it is blocked on every selected day. Returns the `available` flag to send.
 */
export const hourToggleMakesAvailable = (
  view: CalendarBlocks,
  selected: readonly string[],
  hour: number,
): boolean => hourChipState(view, selected, hour) === 'off';

/** « 20/11/2026 » for one day, « 3 jours sélectionnés » for several. */
export function selectionLabel(selected: readonly string[]): string {
  if (selected.length === 1) return (selected[0] ?? '').split('-').reverse().join('/');
  return `${selected.length} jours sélectionnés`;
}

/** The look of a day cell: past, blocked whole, some hours blocked, or free. */
export function dayCellClass(
  view: CalendarBlocks,
  day: string,
  today: string,
  selected: readonly string[],
): string {
  let c = 'd';
  if (day < today) c += ' past';
  else if (view.unavailable.includes(day)) c += ' off';
  else if (view.unavailable_hours.some((u) => u.day === day)) c += ' part';
  if (selected.includes(day)) c += ' sel';
  if (day === today) c += ' today';
  return c;
}

/** « Novembre 2026 ». */
export function monthTitle(month: string): string {
  const label = new Date(`${month}-01T12:00:00`).toLocaleDateString('fr-FR', {
    month: 'long',
    year: 'numeric',
  });
  return label.charAt(0).toUpperCase() + label.slice(1);
}
