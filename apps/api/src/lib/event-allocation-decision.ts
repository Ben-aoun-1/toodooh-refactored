import { and, eq, inArray } from 'drizzle-orm';

import { db } from '../db/client.js';
import { campaigns, eventAllocations, events, screenhosts } from '../db/schema.js';

import { getDispatchConfig } from './dispatch/config.js';
import { releaseBlocHours, runEventRefusalCascade } from './event-dispatch/dispatch.js';

// ONE home for « the owner answers an EVENT proposal » — extracted verbatim from
// routes/screenhosts.ts's decideEventAllocation at SIM-2 (2026-09-13) so the simulator's owner
// emulator drives the same transaction the product route does: owner-scoped FOR UPDATE,
// definitive refusal, and on a refusal the venue's reserved bloc hours are released before the
// event cascade re-places the share.

export type EventDecisionOutcome =
  | { kind: 'not_found' }
  | { kind: 'refused_final' }
  | {
      kind: 'ok';
      id: string;
      statut: 'ACCEPTE' | 'REFUSE';
      screenhostId: string;
      changed: boolean;
    };

export const decideEventAllocation = async (input: {
  allocationId: string;
  ownerId: string;
  statut: 'ACCEPTE' | 'REFUSE';
  /** The instant stamped on the decision — the simulator passes its virtual clock. */
  now?: Date;
}): Promise<EventDecisionOutcome> => {
  const { allocationId, ownerId, statut } = input;
  return db.transaction(async (tx): Promise<EventDecisionOutcome> => {
    const [row] = await tx
      .select({
        allocation: eventAllocations,
        campaignId: campaigns.id,
        matchName: campaigns.name,
        eventId: events.id,
        kickoffAt: events.kickoffAt,
        endsAt: events.endsAt,
      })
      .from(eventAllocations)
      .innerJoin(campaigns, eq(eventAllocations.campaignId, campaigns.id))
      .innerJoin(events, eq(campaigns.eventId, events.id))
      .where(
        and(
          eq(eventAllocations.id, allocationId),
          inArray(
            eventAllocations.screenhostId,
            tx
              .select({ id: screenhosts.id })
              .from(screenhosts)
              .where(eq(screenhosts.ownerId, ownerId)),
          ),
        ),
      )
      .limit(1)
      .for('update', { of: eventAllocations });
    if (!row) return { kind: 'not_found' };

    const current = row.allocation.statut;
    if (current === statut) {
      return {
        kind: 'ok',
        id: row.allocation.id,
        statut,
        screenhostId: row.allocation.screenhostId,
        changed: false,
      };
    }
    if (current === 'REFUSE') return { kind: 'refused_final' };

    await tx
      .update(eventAllocations)
      .set({ statut, decidedAt: input.now ?? new Date() })
      .where(eq(eventAllocations.id, row.allocation.id));

    if (statut === 'REFUSE') {
      await releaseBlocHours(tx, row.eventId, row.allocation.screenhostId);
      await runEventRefusalCascade(
        tx,
        { id: row.campaignId, name: row.matchName },
        { id: row.eventId, kickoffAt: row.kickoffAt, endsAt: row.endsAt },
        {
          screenhostId: row.allocation.screenhostId,
          impressionsTotal: row.allocation.impressionsTotal,
        },
        (await getDispatchConfig()).eventCpmTnd,
      );
    }
    return {
      kind: 'ok',
      id: row.allocation.id,
      statut,
      screenhostId: row.allocation.screenhostId,
      changed: true,
    };
  });
};
