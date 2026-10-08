import { fromZonedTime } from 'date-fns-tz';
import { and, eq, gt, lt } from 'drizzle-orm';

import { db } from '../db/client.js';
import { businessSectors, events, screenhosts } from '../db/schema.js';

import { eventSwitchOnSql } from './event-pricing/event-switch.js';
import { FENETRE_MARGE_MS } from './fenetre-diffusion.js';

// EVT-PLAY1 (operator rulings 2026-10-08, supersedes EVT-STOP's « sold blocs, network-wide ») —
// THE ONE HOME of the event reservation: from kickoff − 1 h to the end + 1 h of every CONFIRMED
// match, the venues that can show events air NO classic campaign — the hour before, the match
// itself and the hour after belong to the event (its pods; the rest of the time the venue's own
// TV). Every consumer — the playlist, proof ingest, the bloc pusher, classic planning, the
// missed-slot detector, settlement, SPS, the simulator — reads its windows here.
//
//   • CONFIRMED = official, not annulé, date AND time confirmed (date_tbc / time_tbc false) —
//     a provisional date never blacks out real classic sales; SOLD OR NOT (Q2 A);
//   • the venues = the event switch on (broadcast_capacity set, CAP-EVT1) in an event-eligible
//     sector — the venues that show matches; every other venue keeps its classic campaigns;
//   • windows from several events are MERGED, so an overlap never counts a minute twice.

export interface BlackoutWindow {
  start: Date;
  end: Date;
}

const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const TUNIS = 'Africa/Tunis';

/** The playlist horizon (S3 A): an offline TV knows the windows of the next 48 h. */
export const BLACKOUT_HORIZON_MS = 48 * HOUR_MS;

/** Sort + merge overlapping or touching windows into disjoint ones. */
export const mergeBlackouts = (windows: readonly BlackoutWindow[]): BlackoutWindow[] => {
  const sorted = [...windows].sort((a, b) => a.start.getTime() - b.start.getTime());
  const merged: BlackoutWindow[] = [];
  for (const w of sorted) {
    const last = merged[merged.length - 1];
    if (last && w.start.getTime() <= last.end.getTime()) {
      if (w.end.getTime() > last.end.getTime()) last.end = new Date(w.end);
    } else {
      merged.push({ start: new Date(w.start), end: new Date(w.end) });
    }
  }
  return merged;
};

/** instant ∈ [start, end) of any window — half-open, like the blocs themselves. */
export const isInBlackout = (windows: readonly BlackoutWindow[], instant: Date): boolean => {
  const t = instant.getTime();
  return windows.some((w) => t >= w.start.getTime() && t < w.end.getTime());
};

/** Whole blacked-out minutes inside the Tunis (date, hour) — the créneau's pro-rata input. */
export const blackoutMinutesInHour = (
  windows: readonly BlackoutWindow[],
  date: string,
  hour: number,
): number => {
  const hourStart = fromZonedTime(`${date}T${String(hour).padStart(2, '0')}:00:00`, TUNIS);
  const from = hourStart.getTime();
  const to = from + HOUR_MS;
  let ms = 0;
  for (const w of mergeBlackouts(windows)) {
    const overlap = Math.min(to, w.end.getTime()) - Math.max(from, w.start.getTime());
    if (overlap > 0) ms += overlap;
  }
  return Math.round(ms / MINUTE_MS);
};

/** The windows a playlist carries: still running or starting within the horizon. */
export const upcomingBlackouts = (
  windows: readonly BlackoutWindow[],
  now: Date,
  horizonMs: number = BLACKOUT_HORIZON_MS,
): BlackoutWindow[] => {
  const t = now.getTime();
  return mergeBlackouts(windows).filter(
    (w) => w.end.getTime() > t && w.start.getTime() < t + horizonMs,
  );
};

/** The event windows over a span, and the venues they apply to. */
export interface EventBlackouts {
  windows: BlackoutWindow[];
  venueIds: ReadonlySet<string>;
}

/** The windows a given venue honours: all of them if it shows events, none otherwise. */
export const windowsForVenue = (b: EventBlackouts, screenhostId: string): BlackoutWindow[] =>
  b.venueIds.has(screenhostId) ? b.windows : [];

/**
 * EVT-STOP (R5) — the blackout minutes NOW of each venue's (date, hour) cells, keyed like slotKey
 * ('date:hour') per venue; only non-zero cells are listed. The missed-slot detector, the NET
 * settlement and SPS read this to find the minutes a LATE reservation took from a frozen plan.
 */
export const blackoutMinutesByVenueCell = async (
  allocations: readonly {
    screenhostId: string;
    creneaux: readonly { date: string; hour: number }[];
  }[],
  executor: Pick<typeof db, 'select'> = db,
): Promise<Map<string, Map<string, number>>> => {
  const byVenue = new Map<string, Map<string, number>>();
  const dates = allocations.flatMap((a) => a.creneaux.map((c) => c.date)).sort();
  if (dates.length === 0) return byVenue;
  const first = dates[0] ?? '';
  const last = dates[dates.length - 1] ?? first;
  const blackouts = await eventBlackouts(
    fromZonedTime(`${first}T00:00:00`, TUNIS),
    new Date(fromZonedTime(`${last}T00:00:00`, TUNIS).getTime() + 24 * HOUR_MS),
    executor,
  );
  if (blackouts.windows.length === 0) return byVenue;
  for (const a of allocations) {
    const windows = windowsForVenue(blackouts, a.screenhostId);
    if (windows.length === 0) continue;
    const cells = byVenue.get(a.screenhostId) ?? new Map<string, number>();
    for (const c of a.creneaux) {
      const minutes = blackoutMinutesInHour(windows, c.date, c.hour);
      if (minutes > 0) cells.set(`${c.date}:${c.hour}`, minutes);
    }
    byVenue.set(a.screenhostId, cells);
  }
  return byVenue;
};

/** One venue's cells — {@link blackoutMinutesByVenueCell} for a single screenhost. */
export const blackoutMinutesByCell = async (
  screenhostId: string,
  cells: readonly { date: string; hour: number }[],
  executor: Pick<typeof db, 'select'> = db,
): Promise<Map<string, number>> =>
  (await blackoutMinutesByVenueCell([{ screenhostId, creneaux: cells }], executor)).get(
    screenhostId,
  ) ?? new Map<string, number>();

/**
 * The merged reservation windows overlapping [from, to) — [kickoff − 1 h, end + 1 h) of every
 * confirmed match — and the venues that honour them.
 */
export const eventBlackouts = async (
  from: Date,
  to: Date,
  executor: Pick<typeof db, 'select'> = db,
): Promise<EventBlackouts> => {
  const rows = await executor
    .select({ kickoffAt: events.kickoffAt, endsAt: events.endsAt })
    .from(events)
    .where(
      and(
        eq(events.source, 'official'),
        eq(events.annule, false),
        eq(events.dateTbc, false),
        eq(events.timeTbc, false),
        lt(events.kickoffAt, new Date(to.getTime() + FENETRE_MARGE_MS)),
        gt(events.endsAt, new Date(from.getTime() - FENETRE_MARGE_MS)),
      ),
    );
  const windows = mergeBlackouts(
    rows.map((r) => ({
      start: new Date(r.kickoffAt.getTime() - FENETRE_MARGE_MS),
      end: new Date(r.endsAt.getTime() + FENETRE_MARGE_MS),
    })),
  );
  if (windows.length === 0) return { windows, venueIds: new Set() };
  const venues = await executor
    .select({ id: screenhosts.id })
    .from(screenhosts)
    .innerJoin(businessSectors, eq(screenhosts.businessSectorId, businessSectors.id))
    .where(and(eventSwitchOnSql(), eq(businessSectors.eventEligible, true)));
  return { windows, venueIds: new Set(venues.map((v) => v.id)) };
};
