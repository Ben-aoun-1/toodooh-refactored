import { and, eq } from 'drizzle-orm';

import { db } from '../../db/client.js';
import { campaigns, eventAllocations, eventAttestations, events } from '../../db/schema.js';

// EV5 — the agent's attestation of a venue for an event (« respecté » / « non respecté »), ONE home:
// the admin route (PUT /api/admin/events/:id/attestations/:screenhost_id) and the simulator's
// attestation switch (SIM-6) both write through here. Extracted verbatim from the route (SIM-6):
// the event must exist, the venue must hold an allocation for it (an attestation on an unrelated
// venue is meaningless and would silently dent its SPS), and the verdict UPSERTS on (event, venue).
// The caller recomputes the venue's SPS (the respect variable moves with the verdict).

export type AttestationWrite =
  | { status: 'EVENT_NOT_FOUND' }
  | { status: 'NOT_ALLOCATED' }
  | { status: 'SAVE_FAILED' }
  | { status: 'OK'; saved: typeof eventAttestations.$inferSelect };

export const upsertEventAttestation = async (input: {
  eventId: string;
  screenhostId: string;
  authorId: string;
  respecte: boolean;
  note?: string | null;
}): Promise<AttestationWrite> => {
  const [event] = await db.select().from(events).where(eq(events.id, input.eventId)).limit(1);
  if (!event) return { status: 'EVENT_NOT_FOUND' };
  const [allocated] = await db
    .select({ id: eventAllocations.id })
    .from(eventAllocations)
    .innerJoin(campaigns, eq(eventAllocations.campaignId, campaigns.id))
    .where(
      and(
        eq(campaigns.eventId, input.eventId),
        eq(eventAllocations.screenhostId, input.screenhostId),
      ),
    )
    .limit(1);
  if (!allocated) return { status: 'NOT_ALLOCATED' };
  const [saved] = await db
    .insert(eventAttestations)
    .values({
      eventId: input.eventId,
      screenhostId: input.screenhostId,
      authorId: input.authorId,
      respecte: input.respecte,
      note: input.note ?? null,
    })
    .onConflictDoUpdate({
      target: [eventAttestations.eventId, eventAttestations.screenhostId],
      set: {
        authorId: input.authorId,
        respecte: input.respecte,
        note: input.note ?? null,
        updatedAt: new Date(),
      },
    })
    .returning();
  return saved ? { status: 'OK', saved } : { status: 'SAVE_FAILED' };
};
