import { eachDayOfInterval, format, getISODay, parseISO } from 'date-fns';

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
 * E2 (VF jours_dispo_i) — a venue's window days MINUS the days its owner declared unavailable.
 * THE day filter: the pool sizes a venue with it, and the coverage map (MAP-4) shows a venue only
 * when it leaves at least one day, so the two can never disagree about « available in the window ».
 * No declaration = the window itself (the same array — the pool relies on nothing more).
 */
export const availableWindowDays = (
  windowDays: WindowDay[],
  declaredUnavailable: ReadonlySet<string> | undefined,
): WindowDay[] =>
  declaredUnavailable ? windowDays.filter((d) => !declaredUnavailable.has(d.date)) : windowDays;
