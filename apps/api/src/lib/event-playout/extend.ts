import { eq, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';

import { db } from '../../db/client.js';
import { events } from '../../db/schema.js';
import { pushPlaylistToAllConnected } from '../playout/push.js';

import { remapEventPositionings } from './reschedule.js';

// EVT-ET1 (operator rulings 2026-10-27) — push a live match's END later, so its « après » ads air
// after extra time / penalties instead of after the 90 minutes. The ONE writer for both the
// automatic jumps (lib/api-football/tracker.ts: +35 min for extra time, +15 min for penalties)
// and the admin's manual « Prolonger » (any duration the admin picks).
//
// It moves ends_at only — the pre-match blocs hang off the kickoff and never move — and remaps
// every live positioning through EV5's remap (blocs by relative index, holds re-reserved) WITHOUT
// notifications (ruling 7.4). The blackout that pauses classic campaigns follows by derivation,
// and every connected TV is re-pushed at once (no new APK: the playlist carries absolute times).
// Nothing is re-priced: the venue keeps the slots it accepted, later.
//
// Ruling 7.3: the end only ever moves LATER — `minutes` must be positive.

export const MIN_EXTENSION_MINUTES = 5;
export const MAX_EXTENSION_MINUTES = 180;

export type ExtensionReason = 'extra_time' | 'penalties' | 'admin';

export interface ExtensionOutcome {
  eventId: string;
  previousEndsAt: Date;
  endsAt: Date;
  positionings: number;
  allocations: number;
}

/**
 * Extend the event by `minutes`. The event row is locked for the whole move, so an automatic jump
 * and an admin click on the same match serialise instead of both reading the old end. `stamp`
 * marks which automatic jump this was, so the tracker never applies the same one twice.
 * Returns null when the event does not exist or is annulé.
 */
export const extendEventEnd = async (
  eventId: string,
  minutes: number,
  reason: ExtensionReason,
  log: FastifyBaseLogger,
): Promise<ExtensionOutcome | null> => {
  if (!Number.isInteger(minutes) || minutes <= 0) {
    throw new Error(`extension must be a positive whole number of minutes (got ${minutes})`);
  }
  const outcome = await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(events)
      .where(eq(events.id, eventId))
      .for('update')
      .limit(1);
    if (!row || row.annule) return null;
    const endsAt = new Date(row.endsAt.getTime() + minutes * 60_000);
    const now = new Date();
    const [moved] = await tx
      .update(events)
      .set({
        endsAt,
        extensionMinutes: sql`${events.extensionMinutes} + ${minutes}`,
        ...(reason === 'extra_time' ? { extraTimeAppliedAt: now } : {}),
        ...(reason === 'penalties' ? { penaltiesAppliedAt: now } : {}),
      })
      .where(eq(events.id, eventId))
      .returning();
    if (!moved) return null;
    const remapped = await remapEventPositionings(
      tx,
      { id: moved.id, name: moved.name, kickoffAt: moved.kickoffAt, endsAt: moved.endsAt },
      { kickoffAt: row.kickoffAt, endsAt: row.endsAt },
      { notify: false },
    );
    return {
      eventId,
      previousEndsAt: row.endsAt,
      endsAt: moved.endsAt,
      positionings: remapped.positionings,
      allocations: remapped.allocations,
    };
  });
  if (!outcome) return null;
  log.info(
    { eventId, reason, minutes, endsAt: outcome.endsAt.toISOString() },
    'event extended — « après » ads moved later',
  );
  // EVT-STOP — the blackout moved with the end: re-push the network. A failure never undoes it;
  // the per-minute bloc pusher and the TVs' next reconnect carry it anyway.
  await pushPlaylistToAllConnected(log).catch((err: unknown) =>
    log.warn({ err, eventId }, 'event extension: network playlist re-push failed'),
  );
  return outcome;
};
