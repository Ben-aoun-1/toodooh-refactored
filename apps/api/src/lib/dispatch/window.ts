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
