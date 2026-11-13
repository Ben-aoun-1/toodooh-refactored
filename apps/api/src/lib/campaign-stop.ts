import { and, eq, inArray } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';

import { db } from '../db/client.js';
import { campaignDispatchPlan, campaigns, eventAllocations, notifications } from '../db/schema.js';

import { tunisDateOf } from './campaign-dates.js';
import { releaseIdleBlocHours } from './event-dispatch/dispatch.js';
import { settleEventPositioning } from './event-playout/settlement.js';
import { releaseLegacySeats } from './event-pricing/legacy-seats.js';
import { pushPlaylistToAllConnected, pushPlaylistToCampaignVenues } from './playout/push.js';
import { reconcileCampaignById } from './reconcile/reconcile-service.js';

// STOP-1 (operator rulings 2026-10-27) — « Arrêter la campagne », superadmin only: a standard
// campaign that is ACTIVE (on air) or UPCOMING (paid, not started) ends now.
//   - active   → `completed`, end_date = today (Tunis): the venues are paid for the hours that
//                aired, the rest is refunded;
//   - upcoming → `completed`, dates untouched: nothing aired, everything is refunded.
// The stop is recorded (stopped_at / stopped_by / stop_reason / original_end_date), settled AT
// ONCE through the ordinary settlement with the stop rules (lib/reconcile: no 20 TND floor, demo
// hours after the stop not counted), the TVs drop the spot (playlist re-push), and the advertiser
// is told. Nothing re-runs a settlement for a campaign already `completed`, so a settlement that
// fails here puts the campaign back as it was rather than leave it ended and unsettled.
// Mariem 05/11 (ruling 1A) — a match POSITIONING stops the same way: `completed`, its dates
// untouched, settled at once by the event settlement at the stop's instant (the blocs that aired
// are billed and paid to the venues, the rest is refunded); its places on the match are free
// again (only live positionings hold them), and a match it held on the 1-minute seats takes the
// 2-minute rule again when nothing binds it any more (lib/event-pricing/legacy-seats).

export const STOPPABLE_STATUSES = ['active', 'upcoming'] as const;
export const CAMPAIGN_STOPPED_TYPE = 'campaign_stopped';
export const STOP_REASON_MIN = 3;
export const STOP_REASON_MAX = 500;

export type StopOutcome =
  | { ok: true; refundTnd: number; spendTnd: number }
  | { ok: false; error: 'NOT_FOUND' | 'NOT_STOPPABLE' | 'NO_PLAN' };

/** The advertiser's notice (the bell shows the title; the body says what happens to the money). */
export const stoppedNoticeTitle = (name: string, positioning = false): string =>
  positioning
    ? `Votre positionnement « ${name} » a été arrêté par Toodooh`
    : `Votre campagne « ${name} » a été arrêtée par Toodooh`;
export const stoppedNoticeBody = (refundTnd: number): string =>
  refundTnd > 0
    ? `Sa diffusion est terminée. ${refundTnd.toFixed(3).replace('.', ',')} TND non diffusés reviennent sur votre solde.`
    : 'Sa diffusion est terminée.';

export async function stopCampaign(input: {
  campaignId: string;
  adminId: string;
  reason: string;
  now?: Date;
  log?: FastifyBaseLogger;
}): Promise<StopOutcome> {
  const now = input.now ?? new Date();
  const today = tunisDateOf(now);

  const flipped = await db.transaction(async (tx) => {
    const [c] = await tx
      .select({
        id: campaigns.id,
        status: campaigns.status,
        eventId: campaigns.eventId,
        campaignType: campaigns.campaignType,
        endDate: campaigns.endDate,
      })
      .from(campaigns)
      .where(eq(campaigns.id, input.campaignId))
      .for('update');
    if (!c) return { ok: false as const, error: 'NOT_FOUND' as const };
    if (!(STOPPABLE_STATUSES as readonly string[]).includes(c.status)) {
      return { ok: false as const, error: 'NOT_STOPPABLE' as const };
    }
    const positioning = c.eventId !== null || c.campaignType === 'event';
    if (!positioning) {
      // The plan row lock serialises the stop with a boost / redispatch round on this campaign.
      const [plan] = await tx
        .select({ id: campaignDispatchPlan.id })
        .from(campaignDispatchPlan)
        .where(eq(campaignDispatchPlan.campaignId, c.id))
        .for('update');
      // Without a plan nothing can be settled — and monthly billing would bill the full budget.
      if (!plan) return { ok: false as const, error: 'NO_PLAN' as const };
    }
    await tx
      .update(campaigns)
      .set({
        status: 'completed',
        stoppedAt: now,
        stoppedBy: input.adminId,
        stopReason: input.reason,
        originalEndDate: c.endDate,
        ...(c.status === 'active' && !positioning ? { endDate: today } : {}),
      })
      .where(and(eq(campaigns.id, c.id), inArray(campaigns.status, [...STOPPABLE_STATUSES])));
    return { ok: true as const, before: c, positioning };
  });
  if (!flipped.ok) return flipped;

  let refundTnd = 0;
  let spendTnd = 0;
  let settlement: string;
  try {
    if (flipped.positioning) {
      const settled = await settleEventPositioning(input.campaignId, now, { stoppedAt: now });
      settlement = settled.status;
      refundTnd = settled.refundTnd ?? 0;
      spendTnd = settled.deliveredTnd ?? 0;
    } else {
      const settled = await reconcileCampaignById(input.campaignId, input.adminId, {
        stoppedAt: now,
      });
      settlement = settled.status;
      refundTnd = settled.status === 'OK' ? settled.valuation.refundTnd : 0;
      spendTnd = settled.status === 'OK' ? settled.valuation.spendTnd : 0;
    }
  } catch (err) {
    // Put the campaign back: an ended campaign with no settlement would never be settled.
    await db
      .update(campaigns)
      .set({
        status: flipped.before.status,
        endDate: flipped.before.endDate,
        stoppedAt: null,
        stoppedBy: null,
        stopReason: null,
        originalEndDate: null,
      })
      .where(eq(campaigns.id, input.campaignId));
    throw err;
  }
  if (flipped.positioning && flipped.before.eventId !== null) {
    const venues = await db
      .select({ screenhostId: eventAllocations.screenhostId })
      .from(eventAllocations)
      .where(eq(eventAllocations.campaignId, input.campaignId));
    await releaseIdleBlocHours(
      db,
      flipped.before.eventId,
      venues.map((v) => v.screenhostId),
    );
    await releaseLegacySeats(db, flipped.before.eventId, now);
  }

  const [row] = await db
    .select({ advertiserId: campaigns.advertiserId, name: campaigns.name })
    .from(campaigns)
    .where(eq(campaigns.id, input.campaignId));
  if (row) {
    await db.insert(notifications).values({
      userId: row.advertiserId,
      type: CAMPAIGN_STOPPED_TYPE,
      title: stoppedNoticeTitle(row.name, flipped.positioning),
      body: stoppedNoticeBody(refundTnd),
      campaignId: input.campaignId,
    });
  }
  // The airing gate requires `active`: the re-push drops the spot from every venue's playlist. A
  // positioning's blocs may black out classic campaigns network-wide (EVT-STOP): every connected
  // venue is re-pushed.
  if (flipped.positioning) await pushPlaylistToAllConnected(input.log);
  else await pushPlaylistToCampaignVenues(input.campaignId, input.log);
  input.log?.info(
    { campaignId: input.campaignId, settlement, refundTnd },
    'campaign stopped by a superadmin',
  );
  return { ok: true, refundTnd, spendTnd };
}
