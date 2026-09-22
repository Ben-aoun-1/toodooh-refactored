// DASH-1 (R3) — the Tunis calendar month containing an instant, as a half-open instant range.
//
// Built ONLY from the codebase's existing Tunis conventions — no new timezone math:
//   • tunisDateOf (campaign-dates.ts) names the Tunis calendar date of the instant;
//   • a Tunis day starts at `${isoDay}T00:00:00+01:00` (Tunisia is UTC+1 with no DST since 2008 —
//     the same anchor campaign-lifecycle, events and sps-observations use);
//   • plusCalendarDays walks the calendar in UTC-noon space. The 1st + 31 days always lands in
//     the NEXT month (no month is longer than 31 days, none shorter than 28), whose 1st is the
//     exclusive upper bound.
// Callers filter `start <= ts < end`, so a settlement at 00:30 Tunis on the 1st belongs to the new
// month even while the server (TZ unset = UTC) still reads the 30th.
import { plusCalendarDays, tunisDateOf } from './campaign-dates.js';

export interface TunisMonth {
  /** 'YYYY-MM' — the Tunis calendar month. */
  month: string;
  /** The month's first instant: the 1st at 00:00 Tunis (inclusive). */
  start: Date;
  /** The next month's first instant (exclusive). */
  end: Date;
}

export function tunisMonthOf(instant: Date): TunisMonth {
  const month = tunisDateOf(instant).slice(0, 7);
  const nextMonth = plusCalendarDays(`${month}-01`, 31).slice(0, 7);
  return {
    month,
    start: new Date(`${month}-01T00:00:00+01:00`),
    end: new Date(`${nextMonth}-01T00:00:00+01:00`),
  };
}
