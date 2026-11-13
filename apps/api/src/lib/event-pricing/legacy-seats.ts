import { and, eq, gt, inArray } from 'drizzle-orm';

import { db } from '../../db/client.js';
import { campaigns, events } from '../../db/schema.js';

// Mariem 04/11 (mig 0104) — a match already sold under EVT-MIN1's 1-minute seats keeps them while
// a positioning launched under them can still air: never two seat models in one ad pod. Mariem
// 05/11 — once none is left (stopped by a superadmin, deleted), a match still to come takes the
// 2-minute rule again (events.seat_minutes NULL, ./minutes.ts eventSeatModel). A match already
// over keeps its model: its positionings' reports read it.

type Executor = typeof db | Parameters<Parameters<(typeof db)['transaction']>[0]>[0];

/** The positionings that bind a match's seat model: launched and not over. */
export const SEAT_BINDING_STATUSES = ['pending', 'upcoming', 'active'] as const;

/** The 2-minute rule again when nothing binds the match any more. True when it was released. */
export const releaseLegacySeats = async (
  executor: Executor,
  eventId: string,
  now: Date = new Date(),
): Promise<boolean> => {
  const [binding] = await executor
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(
      and(eq(campaigns.eventId, eventId), inArray(campaigns.status, [...SEAT_BINDING_STATUSES])),
    )
    .limit(1);
  if (binding) return false;
  const released = await executor
    .update(events)
    .set({ seatMinutes: null })
    .where(and(eq(events.id, eventId), eq(events.seatMinutes, 1), gt(events.endsAt, now)))
    .returning({ id: events.id });
  return released.length > 0;
};
