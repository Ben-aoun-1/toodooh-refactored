import { formatInTimeZone } from 'date-fns-tz';

// SIM-2 — the virtual clock. A simulation's `virtual_now` is an instant; every engine in this
// codebase thinks in Africa/Tunis calendar days and clock hours, so the tick converts once here
// and passes the instant itself to the engines (they all accept an injected `now`).

export const TZ = 'Africa/Tunis';

export interface VirtualMoment {
  /** The instant itself — what the engines receive as `now`. */
  at: Date;
  /** Tunis calendar day, YYYY-MM-DD. */
  date: string;
  /** Tunis clock hour, 0–23. */
  hour: number;
  /** ISO weekday, 1 = Monday … 7 = Sunday, in Tunis. */
  dayOfWeek: number;
}

export const momentOf = (at: Date): VirtualMoment => ({
  at,
  date: formatInTimeZone(at, TZ, 'yyyy-MM-dd'),
  hour: Number(formatInTimeZone(at, TZ, 'H')),
  dayOfWeek: Number(formatInTimeZone(at, TZ, 'i')),
});

/** The same instant, `hours` later. */
export const advance = (at: Date, hours: number): Date =>
  new Date(at.getTime() + hours * 60 * 60 * 1000);

/** An instant INSIDE the given virtual hour, `minute` minutes in — where proofs are stamped. */
export const withinHour = (at: Date, minute: number): Date =>
  new Date(at.getTime() + Math.min(59, Math.max(0, minute)) * 60 * 1000);
