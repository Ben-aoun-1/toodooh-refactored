import { and, eq, inArray } from 'drizzle-orm';

import { db } from '../../db/client.js';
import {
  campaignReconciliation,
  campaigns,
  eventAllocations,
  events,
  notifications,
  screenhosts,
} from '../../db/schema.js';
import { tunisDateOf } from '../campaign-dates.js';
import { releaseBlocHours, reserveBlocHours } from '../event-dispatch/dispatch.js';
import { fenetreDiffusion } from '../fenetre-diffusion.js';

import { parseBlocs } from './spots.js';

// EV5 (R4) — REPORTER / ANNULER / PROLONGATION. The window is always DERIVED from the event's
// instants (EV1's ruling: no window column exists), so moving a match is a matter of re-deriving
// and REMAPPING what was frozen at placement:
//
//   • the positioning's snapshotted start/end dates (EV3 froze them for the CF-S1 machinery),
//   • each allocation's blocs jsonb — by RELATIVE INDEX into the six-bloc grid: the venue keeps
//     the same slots it accepted (2nd pre-match bloc stays the 2nd pre-match bloc), so an owner's
//     decision survives the move without a new proposal,
//   • the hour_reservations — released and rewritten on the new instants (a moved match must not
//     keep holding the old hours against the campaign engine).
//
// An ends_at-only edit (a prolongation) remaps identically: the pre-match blocs are unchanged by
// construction (they hang off the kickoff) and the post-match ones follow the new end.
//
// Terminal positionings (completed / rejected / already settled) are LEFT ALONE — their money is
// closed. Everything else is re-snapshotted and re-notified in French.

export const EVENT_REPORTED_TITLE = 'Événement reporté';
export const eventReportedAdvertiserBody = (matchName: string): string =>
  `Le match ${matchName} a été reporté. Votre positionnement et ses créneaux ont été recalculés sur la nouvelle fenêtre de diffusion.`;
export const eventReportedOwnerBody = (matchName: string): string =>
  `Le match ${matchName} a été reporté. Vos créneaux de diffusion ont été recalculés sur la nouvelle fenêtre — votre acceptation reste valable.`;

export const EVENT_CANCELLED_TITLE = 'Événement annulé';
export const eventCancelledAdvertiserBody = (matchName: string, refundTnd: number): string =>
  `Le match ${matchName} a été annulé. Votre positionnement est clos et ${refundTnd.toLocaleString('fr-FR')} TND vous ont été remboursés intégralement.`;
export const eventCancelledOwnerBody = (matchName: string): string =>
  `Le match ${matchName} a été annulé. Les créneaux réservés sur vos écrans sont libérés.`;

/** The positioning statuses whose money is still open (R4 acts on these only). */
const LIVE_STATUSES = ['draft', 'pending', 'upcoming', 'active'] as const;

interface RemapCounts {
  positionings: number;
  allocations: number;
}

/**
 * Remap every live positioning of an event onto the NEW window. Runs on the caller's transaction
 * so the event's instants and everything derived from them move atomically.
 */
export const remapEventPositionings = async (
  tx: Parameters<Parameters<(typeof db)['transaction']>[0]>[0],
  event: { id: string; name: string; kickoffAt: Date; endsAt: Date },
  previous: { kickoffAt: Date; endsAt: Date },
): Promise<RemapCounts> => {
  const oldGrid = fenetreDiffusion(previous.kickoffAt, previous.endsAt);
  const newGrid = fenetreDiffusion(event.kickoffAt, event.endsAt);
  const oldIndexByStart = new Map(
    oldGrid.blocs.map((bloc, index) => [bloc.start.toISOString(), index]),
  );

  const positionings = await tx
    .select({ id: campaigns.id, advertiserId: campaigns.advertiserId, status: campaigns.status })
    .from(campaigns)
    .where(and(eq(campaigns.eventId, event.id), inArray(campaigns.status, [...LIVE_STATUSES])));
  if (positionings.length === 0) return { positionings: 0, allocations: 0 };

  // The dates the CF-S1 machinery reads are re-snapshotted from the new window.
  await tx
    .update(campaigns)
    .set({
      startDate: tunisDateOf(newGrid.windowStart),
      endDate: tunisDateOf(newGrid.windowEnd),
    })
    .where(
      inArray(
        campaigns.id,
        positionings.map((p) => p.id),
      ),
    );

  const allocations = await tx
    .select()
    .from(eventAllocations)
    .where(
      inArray(
        eventAllocations.campaignId,
        positionings.map((p) => p.id),
      ),
    );

  const touchedVenues = new Set<string>();
  for (const allocation of allocations) {
    const stored = parseBlocs(allocation.blocs);
    const remapped = stored.map((bloc) => {
      // RELATIVE INDEX: the same slot in the new grid keeps the venue's accepted position.
      const index = oldIndexByStart.get(new Date(bloc.start).toISOString());
      const target = index === undefined ? undefined : newGrid.blocs[index];
      return target === undefined
        ? bloc // an unrecognisable bloc (hand-edited data) is left as-is rather than dropped
        : {
            start: target.start.toISOString(),
            end: target.end.toISOString(),
            impressions: bloc.impressions,
          };
    });
    await tx
      .update(eventAllocations)
      .set({ blocs: remapped })
      .where(eq(eventAllocations.id, allocation.id));
    // The holds move with the blocs: release the venue's old cells for this event, re-reserve.
    await releaseBlocHours(tx, event.id, allocation.screenhostId);
    await reserveBlocHours(tx, event.id, allocation.screenhostId, remapped);
    touchedVenues.add(allocation.screenhostId);
  }

  // Notifications: every advertiser once, every affected venue OWNER once.
  await tx.insert(notifications).values(
    positionings.map((p) => ({
      userId: p.advertiserId,
      type: 'event_reported',
      title: EVENT_REPORTED_TITLE,
      body: eventReportedAdvertiserBody(event.name),
      campaignId: p.id,
    })),
  );
  if (touchedVenues.size > 0) {
    const owners = await tx
      .selectDistinct({ ownerId: screenhosts.ownerId })
      .from(screenhosts)
      .where(inArray(screenhosts.id, [...touchedVenues]));
    const ownerIds = owners.flatMap((o) => (o.ownerId === null ? [] : [o.ownerId]));
    if (ownerIds.length > 0) {
      await tx.insert(notifications).values(
        ownerIds.map((ownerId) => ({
          userId: ownerId,
          type: 'event_reported',
          title: EVENT_REPORTED_TITLE,
          body: eventReportedOwnerBody(event.name),
        })),
      );
    }
  }

  return { positionings: positionings.length, allocations: allocations.length };
};

export interface EventCancellationCounts {
  positionings: number;
  refundedTnd: number;
}

/**
 * Void an annulé event's positionings: release every hold, settle each positioning with a FULL
 * refund (spend 0 — E6's money movement, so nothing is ever debited), close it, and notify both
 * sides. Idempotent per positioning via campaign_reconciliation's UNIQUE(campaign_id).
 */
export const voidEventPositionings = async (
  tx: Parameters<Parameters<(typeof db)['transaction']>[0]>[0],
  event: { id: string; name: string },
): Promise<EventCancellationCounts> => {
  const positionings = await tx
    .select({ id: campaigns.id, advertiserId: campaigns.advertiserId })
    .from(campaigns)
    .where(and(eq(campaigns.eventId, event.id), inArray(campaigns.status, [...LIVE_STATUSES])));
  if (positionings.length === 0) return { positionings: 0, refundedTnd: 0 };

  const allocations = await tx
    .select()
    .from(eventAllocations)
    .where(
      inArray(
        eventAllocations.campaignId,
        positionings.map((p) => p.id),
      ),
    );

  const engagedByPositioning = new Map<string, number>();
  const impressionsByPositioning = new Map<string, number>();
  const touchedVenues = new Set<string>();
  for (const allocation of allocations) {
    if (allocation.statut !== 'REFUSE') {
      engagedByPositioning.set(
        allocation.campaignId,
        (engagedByPositioning.get(allocation.campaignId) ?? 0) + Number(allocation.montantTnd),
      );
      impressionsByPositioning.set(
        allocation.campaignId,
        (impressionsByPositioning.get(allocation.campaignId) ?? 0) + allocation.impressionsTotal,
      );
    }
    await releaseBlocHours(tx, event.id, allocation.screenhostId);
    touchedVenues.add(allocation.screenhostId);
  }

  let refundedTnd = 0;
  for (const positioning of positionings) {
    const engaged = Math.round((engagedByPositioning.get(positioning.id) ?? 0) * 1000) / 1000;
    const expectedImp = impressionsByPositioning.get(positioning.id) ?? 0;
    // spend_tnd = 0 → the wallet debits nothing: the FULL refund, E6's mechanism unchanged.
    await tx
      .insert(campaignReconciliation)
      .values({
        campaignId: positioning.id,
        expectedImp,
        deliveredImp: 0,
        manquementImp: expectedImp,
        pPerteTnd: String(engaged),
        refundTnd: String(engaged),
        spendTnd: '0',
        status: engaged > 0 ? 'partial' : 'reussie',
        reconciledBy: null,
      })
      .onConflictDoNothing();
    refundedTnd += engaged;
    await tx.insert(notifications).values({
      userId: positioning.advertiserId,
      type: 'event_cancelled',
      title: EVENT_CANCELLED_TITLE,
      body: eventCancelledAdvertiserBody(event.name, engaged),
      campaignId: positioning.id,
    });
  }
  await tx
    .update(campaigns)
    .set({ status: 'completed' })
    .where(
      inArray(
        campaigns.id,
        positionings.map((p) => p.id),
      ),
    );

  if (touchedVenues.size > 0) {
    const owners = await tx
      .selectDistinct({ ownerId: screenhosts.ownerId })
      .from(screenhosts)
      .where(inArray(screenhosts.id, [...touchedVenues]));
    const ownerIds = owners.flatMap((o) => (o.ownerId === null ? [] : [o.ownerId]));
    if (ownerIds.length > 0) {
      await tx.insert(notifications).values(
        ownerIds.map((ownerId) => ({
          userId: ownerId,
          type: 'event_cancelled',
          title: EVENT_CANCELLED_TITLE,
          body: eventCancelledOwnerBody(event.name),
        })),
      );
    }
  }

  return { positionings: positionings.length, refundedTnd: Math.round(refundedTnd * 1000) / 1000 };
};

/** Re-read an event row (the routes' shared helper after a write). */
export const loadEvent = async (eventId: string) => {
  const [row] = await db.select().from(events).where(eq(events.id, eventId)).limit(1);
  return row ?? null;
};
