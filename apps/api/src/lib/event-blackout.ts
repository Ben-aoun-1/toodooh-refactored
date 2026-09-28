import { fromZonedTime } from 'date-fns-tz';
import { and, eq, gt, inArray, lt } from 'drizzle-orm';

import { db } from '../db/client.js';
import { campaigns, eventAllocations, events } from '../db/schema.js';

import { parseBlocs } from './event-playout/spots.js';

// EVT-STOP (operator rulings 2026-09-28, docs/daily/2026-09-28.md §2) — THE ONE HOME of the event
// blackout: during a SOLD event's blocs, every screen of the network stops classic campaigns
// (only event spots air, where accepted). Every consumer — the playlist, proof ingest, the bloc
// pusher, classic planning, the missed-slot detector, SPS, the simulator — reads its windows here.
//
//   • SOLD (S1 A + P1 A) = not annulé AND ≥ 1 positioning (campaign_type 'event') in upcoming or
//     active — a pending (unreviewed) positioning does NOT black the network out;
//   • the windows are the blocs that positioning's LIVE allocations placed (EN_ATTENTE holds
//     its blocs, ACCEPTE airs them; a REFUSE released them) — a bloc no venue could take blacks
//     out nothing;
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

/**
 * EVT-STOP (R5) — the blackout minutes NOW of each given (date, hour) cell, keyed like
 * slotKey ('date:hour'); only non-zero cells are listed. The missed-slot detector and the NET
 * settlement read this to find the minutes a LATE blackout took from a frozen plan.
 */
export const blackoutMinutesByCell = async (
  cells: readonly { date: string; hour: number }[],
  executor: Pick<typeof db, 'select'> = db,
): Promise<Map<string, number>> => {
  const byCell = new Map<string, number>();
  if (cells.length === 0) return byCell;
  const dates = cells.map((c) => c.date).sort();
  const first = dates[0] ?? '';
  const last = dates[dates.length - 1] ?? first;
  const windows = await soldEventBlackouts(
    fromZonedTime(`${first}T00:00:00`, TUNIS),
    new Date(fromZonedTime(`${last}T00:00:00`, TUNIS).getTime() + 24 * HOUR_MS),
    executor,
  );
  if (windows.length === 0) return byCell;
  for (const c of cells) {
    const minutes = blackoutMinutesInHour(windows, c.date, c.hour);
    if (minutes > 0) byCell.set(`${c.date}:${c.hour}`, minutes);
  }
  return byCell;
};

/**
 * The merged blackout windows overlapping [from, to): the placed blocs of every live allocation
 * of every sold positioning of every non-annulé event.
 */
export const soldEventBlackouts = async (
  from: Date,
  to: Date,
  executor: Pick<typeof db, 'select'> = db,
): Promise<BlackoutWindow[]> => {
  // Every bloc lies in [kickoff − 1 h, end + 1 h] (lib/fenetre-diffusion), so the event row
  // bounds the scan before the jsonb is read.
  const rows = await executor
    .select({ blocs: eventAllocations.blocs })
    .from(eventAllocations)
    .innerJoin(campaigns, eq(eventAllocations.campaignId, campaigns.id))
    .innerJoin(events, eq(campaigns.eventId, events.id))
    .where(
      and(
        eq(campaigns.campaignType, 'event'),
        inArray(campaigns.status, ['upcoming', 'active']),
        inArray(eventAllocations.statut, ['EN_ATTENTE', 'ACCEPTE']),
        eq(events.annule, false),
        lt(events.kickoffAt, new Date(to.getTime() + HOUR_MS)),
        gt(events.endsAt, new Date(from.getTime() - HOUR_MS)),
      ),
    );
  const windows: BlackoutWindow[] = [];
  for (const row of rows) {
    for (const bloc of parseBlocs(row.blocs)) {
      const start = new Date(bloc.start);
      const end = new Date(bloc.end);
      if (end.getTime() > from.getTime() && start.getTime() < to.getTime()) {
        windows.push({ start, end });
      }
    }
  }
  return mergeBlackouts(windows);
};
