import { differenceInCalendarDays, format } from 'date-fns';

import { parseCampaignUiDate } from './wizard-dates';

/**
 * Pure formatters for the wizard's Validation-step recap. The date/duration helpers read the
 * date-only wizard strings ('YYYY-MM-DD') via the shared `parseCampaignUiDate` so the summary and the
 * dispatch engine agree on the calendar.
 */

/**
 * Inclusive campaign-day count over [start, end] — BOTH endpoints counted, matching the engine's
 * fenêtre (`buildWindowDays` → `eachDayOfInterval({ start, end })`). 28/12 → 03/01 is 7 days. Returns
 * null when either date is missing/invalid or the range is inverted.
 */
export function inclusiveDayCount(start: string | null, end: string | null): number | null {
  const s = parseCampaignUiDate(start);
  const e = parseCampaignUiDate(end);
  if (!s || !e) return null;
  const diff = differenceInCalendarDays(e, s);
  if (diff < 0) return null;
  return diff + 1;
}

/** A date-only wizard string as dd/MM/yyyy, or an em dash when absent/unparseable. */
export function formatUiDate(value: string | null): string {
  const d = parseCampaignUiDate(value);
  return d ? format(d, 'dd/MM/yyyy') : '—';
}

/** A whole-second duration as an mm:ss clock (15 → "00:15"), or an em dash when null/invalid. */
export function formatDurationClock(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return '—';
  const total = Math.floor(seconds);
  const mm = String(Math.floor(total / 60)).padStart(2, '0');
  const ss = String(total % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}
