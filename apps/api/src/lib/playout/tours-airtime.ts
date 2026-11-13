import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';

import { BLACKOUT_HORIZON_MS, type BlackoutWindow, mergeBlackouts } from '../event-blackout.js';

// DISP-TOURS — when a tours allocation may air, PURE. The tours engine allocates SPECIFIC hours (a
// venue's peak hours of each weekday, tour after tour), each with its own passages: R_plein, or
// the partial tranche's k. A v1 allocation aired at one r_i every hour of its window; a tours one
// airs only inside its créneaux. Server-side only — no new APK: the playlist entry carries
//   • reps_per_hour = the passages of the hour on air (else of the next allocated hour, so a
//     player that goes offline starts that hour at the right cadence), refreshed by the hourly
//     re-push (./hourly-push.ts);
//   • blackouts = every instant of the next 48 h OUTSIDE its créneaux (EVT-STOP's field, which the
//     player honours offline too), merged with the event windows by the caller.

const TZ = 'Africa/Tunis';
const HOUR_MS = 60 * 60 * 1000;

export interface ToursAirtime {
  /** The passages of the hour on air, or null when the allocation has no créneau now. */
  currentReps: number | null;
  /** The passages of the next allocated hour in the horizon (null = none). */
  nextReps: number | null;
  /** [now, now + horizon) minus the allocated hours — when the entry must NOT air. */
  offWindows: BlackoutWindow[];
}

const hourStart = (date: string, hour: number): Date =>
  fromZonedTime(`${date}T${String(hour).padStart(2, '0')}:00:00`, TZ);

export const toursAirtime = (
  creneaux: readonly { date: string; hour: number; reps: number }[],
  now: Date,
  horizonMs: number = BLACKOUT_HORIZON_MS,
): ToursAirtime => {
  const t = now.getTime();
  const horizonEnd = t + horizonMs;
  const today = formatInTimeZone(now, TZ, 'yyyy-MM-dd');
  const hour = Number(formatInTimeZone(now, TZ, 'H'));
  let currentReps: number | null = null;
  let nextReps: number | null = null;
  let nextStart = Number.POSITIVE_INFINITY;
  const on: BlackoutWindow[] = [];
  for (const c of creneaux) {
    if (c.reps <= 0) continue;
    if (c.date === today && c.hour === hour) currentReps = c.reps;
    const start = hourStart(c.date, c.hour);
    const end = new Date(start.getTime() + HOUR_MS);
    if (end.getTime() <= t || start.getTime() >= horizonEnd) continue;
    on.push({ start, end });
    if (start.getTime() > t && start.getTime() < nextStart) {
      nextStart = start.getTime();
      nextReps = c.reps;
    }
  }
  const offWindows: BlackoutWindow[] = [];
  let cursor = t;
  for (const w of mergeBlackouts(on)) {
    if (w.start.getTime() > cursor) offWindows.push({ start: new Date(cursor), end: w.start });
    cursor = Math.max(cursor, w.end.getTime());
  }
  if (cursor < horizonEnd) offWindows.push({ start: new Date(cursor), end: new Date(horizonEnd) });
  return { currentReps, nextReps, offWindows };
};
