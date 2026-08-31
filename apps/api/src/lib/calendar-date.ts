import { format, isValid, parseISO } from 'date-fns';

/**
 * A well-shaped-but-impossible day (`2026-02-30`) passes a `^\d{4}-\d{2}-\d{2}$` regex and then
 * reaches Postgres, which answers with a 500 where the contract says 400. Every route that takes
 * an ISO day and lets it touch a `date` column validates through here.
 *
 * Banked as a rider in AUD-HOURLY1-A (the ingest's own `date`); folded in and shared here by
 * slice C, which made the owner reads' `from`/`to` reach a real DATE range query too.
 */
export const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const CALENDAR_DAY_MSG = 'must be a real YYYY-MM-DD calendar day';

/** True only for a day that actually exists — parseISO rolls 2026-02-30 forward, so round-trip. */
export const isCalendarDate = (value: string): boolean => {
  const parsed = parseISO(value);
  return isValid(parsed) && format(parsed, 'yyyy-MM-dd') === value;
};
