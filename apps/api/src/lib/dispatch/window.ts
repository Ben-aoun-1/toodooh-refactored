import { eachDayOfInterval, format, getISODay, parseISO } from 'date-fns';

import { isWholeDayUnavailable } from '../unavailable-hours.js';

import { type WindowDay } from './plan.js';

// Expand a campaign fenêtre [startDate, endDate] (inclusive, ISO date strings) into the per-day list
// the cadence builder needs. getISODay → 1=Mon … 7=Sun, matching wedooh's affluence convention.
export const buildWindowDays = (startDate: string, endDate: string): WindowDay[] => {
  const start = parseISO(startDate);
  const end = parseISO(endDate);
  if (end < start) return [];
  return eachDayOfInterval({ start, end }).map((d) => ({
    date: format(d, 'yyyy-MM-dd'),
    dayOfWeek: getISODay(d),
  }));
};

/**
 * E2 (VF jours_dispo_i) → HOUR-UNAV1 — a venue's window days that still have at least ONE hour the
 * owner did not declare unavailable. THE day filter: the pool sizes a venue with it, and the
 * coverage map (MAP-4) shows a venue only when it leaves at least one day, so the two can never
 * disagree about « available in the window ». A day with SOME unavailable hours stays — those
 * hours drop out cell by cell in the pool. No declaration = the window itself (the same array).
 */
export const availableWindowDays = (
  windowDays: WindowDay[],
  unavailableCells: ReadonlySet<string> | undefined,
  openingHour: number | null,
  closingHour: number | null,
): WindowDay[] =>
  unavailableCells
    ? windowDays.filter(
        (d) => !isWholeDayUnavailable(d.date, unavailableCells, openingHour, closingHour),
      )
    : windowDays;
