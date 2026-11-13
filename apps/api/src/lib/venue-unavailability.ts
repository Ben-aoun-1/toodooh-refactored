import { and, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';

import { db } from '../db/client.js';
import {
  campaignDispatchAllocation,
  campaignDispatchPlan,
  campaigns,
  eventAllocations,
  events,
  screenhostUnavailability,
} from '../db/schema.js';

import { runRefusalCascade } from './dispatch/cascade.js';
import { campaignCpmRates } from './dispatch/config.js';
import { createEngineTrace, type EngineTrace } from './engine-journal/trace.js';
import {
  releaseBlocHours,
  reserveBlocHours,
  runEventRefusalCascade,
} from './event-dispatch/dispatch.js';
import { parseBlocs } from './event-playout/spots.js';
import { blocCells } from './event-pricing/pricing.js';
import { recomputeVenueSps } from './sps-score.js';

// E2 / CAL-1 — declare or undeclare ONE unavailable day of a venue, moving the day's live share.
// Moved VERBATIM out of PUT /api/screenhosts/:id/unavailability (HOST-EDIT1, 2026-10-25) so the
// admin « Fiche Host » mirror (PUT /api/admin/screenhosts/:id/unavailability) runs the SAME
// re-placement — the route keeps its scoping and the FUTURE-only day check; this does the write.
//
// CAL-1 (Mejri 11/09 point 6, operator ruling 2026-09-12: « it gets redispatched ») — a declared
// day that carries ACCEPTE/EN_ATTENTE créneaux of a live campaign MOVES that day's share. In ONE
// transaction: the day row → the colliding allocations (plan locked FOR UPDATE, like E6) → each
// loses the day's créneaux and the day's facturable value (⌊Σ impressions × T⌋) → the value is
// re-placed: pre-diffusion (pending/upcoming) through the E3 cascade at once (partial mode, the
// source venue excluded, allocation kept), mid-flight (active) into the plan's reliquat_stocke so
// E6's next round re-places it future-only. Any failure rolls the declaration back — a share is
// never left half-moved. Undeclaring moves nothing back (returns []).
export interface RedispatchedShare {
  campaign_id: string;
  campaign_name: string;
  /** DEACT-1 — 'evenement': a sold event slot of a deactivated Host, re-placed (event cascade). */
  mode: 'cascade' | 'reliquat' | 'evenement';
  slots_moved: number;
  v_fact: number;
  absorbed: number;
  residual: number;
}

export const setVenueDayUnavailability = async (
  venueId: string,
  day: string,
  unavailable: boolean,
  logger: FastifyBaseLogger,
): Promise<RedispatchedShare[]> => {
  if (!unavailable) {
    await db
      .delete(screenhostUnavailability)
      .where(
        and(
          eq(screenhostUnavailability.screenhostId, venueId),
          eq(screenhostUnavailability.day, day),
        ),
      );
    return [];
  }

  // LOG1 — one cascade trace per re-placed campaign, flushed after the tx on both outcomes.
  const traces: EngineTrace[] = [];
  const redispatched = await db
    .transaction(async (tx) => {
      // The day row FIRST, so the cascade's pool assembly already excludes this venue/day.
      await tx
        .insert(screenhostUnavailability)
        .values({ screenhostId: venueId, day })
        .onConflictDoNothing();

      return moveClassicShares(
        tx,
        venueId,
        (c) => c.date === day,
        { firstDate: day, lastDate: day },
        traces,
      );
    })
    .catch(async (err: unknown) => {
      await Promise.all(traces.map((tr) => tr.finish('rolled_back', { reason: 'ERROR' })));
      throw err;
    });
  await Promise.all(traces.map((tr) => tr.finish('committed', {})));

  // E4 — a moved share changes this venue's engagement; recompute its SPS, failure-tolerated.
  if (redispatched.length > 0) {
    try {
      await recomputeVenueSps(venueId);
    } catch (err) {
      logger.warn({ err, screenhostId: venueId }, 'SPS on-declaration recompute failed');
    }
  }
  return redispatched;
};

type Tx = Parameters<Parameters<(typeof db)['transaction']>[0]>[0];

/**
 * DEACT-1 — moves this venue's live shares off the clock cells `inScope` selects: the classic
 * créneaux (moveClassicShares) and the sold EVENT slots, through the event refusal cascade. Used by
 * an account deactivation (every future hour). The caller has already made the venue ineligible
 * (owner status) in the same transaction, so no cascade lands back on it.
 */
export const moveVenueShares = async (
  tx: Tx,
  venueId: string,
  inScope: (c: { date: string; hour: number }) => boolean,
  window: { firstDate: string; lastDate: string },
  traces: EngineTrace[],
  now: Date,
): Promise<RedispatchedShare[]> => [
  ...(await moveClassicShares(tx, venueId, inScope, window, traces)),
  ...(await moveEventSlots(tx, venueId, inScope, now)),
];

/**
 * CAL-1 — moves this venue's classic créneaux off the clock cells `inScope` selects, within the
 * campaign window [firstDate, lastDate]: pending / upcoming → refusal cascade; active → the stored
 * reliquat E6 re-places. Shared by a declared unavailable day and an account deactivation.
 */
const moveClassicShares = async (
  tx: Tx,
  venueId: string,
  inScope: (c: { date: string; hour: number }) => boolean,
  window: { firstDate: string; lastDate: string },
  traces: EngineTrace[],
): Promise<RedispatchedShare[]> => {
  const { firstDate, lastDate } = window;
  // The colliding shares: this venue's live allocations whose campaign window covers the
  // declared hours and whose frozen créneaux touch them. Plans locked FOR UPDATE — E6 rounds
  // and cascades serialize on the plan row (redispatch.ts idiom).
  const rows = await tx
    .select({
      allocation: campaignDispatchAllocation,
      plan: campaignDispatchPlan,
      campaignId: campaigns.id,
      campaignName: campaigns.name,
      campaignStatus: campaigns.status,
      campaignStart: campaigns.startDate,
      campaignEnd: campaigns.endDate,
    })
    .from(campaignDispatchAllocation)
    .innerJoin(campaignDispatchPlan, eq(campaignDispatchAllocation.planId, campaignDispatchPlan.id))
    .innerJoin(campaigns, eq(campaignDispatchPlan.campaignId, campaigns.id))
    .where(
      and(
        eq(campaignDispatchAllocation.screenhostId, venueId),
        inArray(campaignDispatchAllocation.statutAcceptation, ['ACCEPTE', 'EN_ATTENTE']),
        inArray(campaigns.status, ['pending', 'upcoming', 'active']),
        lte(campaigns.startDate, lastDate),
        gte(campaigns.endDate, firstDate),
      ),
    )
    .for('update', { of: campaignDispatchPlan });

  const moved: RedispatchedShare[] = [];
  for (const row of rows) {
    const removed = row.allocation.creneaux.filter(inScope);
    if (removed.length === 0) continue;
    const kept = row.allocation.creneaux.filter((c) => !inScope(c));
    const t = Number(row.plan.tTierCoef);
    const cpm = Number(row.plan.cpm);
    const vFact = Math.min(
      row.allocation.iiPotentiel,
      Math.floor(removed.reduce((sum, c) => sum + c.impressions, 0) * t),
    );
    const iiPotentiel = row.allocation.iiPotentiel - vFact;
    await tx
      .update(campaignDispatchAllocation)
      .set({
        creneaux: kept,
        iiPotentiel,
        revenuPrevisionnel: String((iiPotentiel * cpm) / 1000),
      })
      .where(eq(campaignDispatchAllocation.id, row.allocation.id));

    if (vFact === 0) {
      moved.push({
        campaign_id: row.campaignId,
        campaign_name: row.campaignName,
        mode: 'cascade',
        slots_moved: removed.length,
        v_fact: 0,
        absorbed: 0,
        residual: 0,
      });
      continue;
    }
    if (
      (row.campaignStatus === 'pending' || row.campaignStatus === 'upcoming') &&
      row.campaignStart !== null &&
      row.campaignEnd !== null
    ) {
      const trace = createEngineTrace('cascade', row.campaignId);
      traces.push(trace);
      const outcome = await runRefusalCascade(
        tx,
        {
          plan: row.plan,
          campaign: {
            id: row.campaignId,
            name: row.campaignName,
            startDate: row.campaignStart,
            endDate: row.campaignEnd,
          },
          refused: {
            id: row.allocation.id,
            screenhostId: venueId,
            iiPotentiel: vFact,
          },
          partial: true,
        },
        trace,
      );
      moved.push({
        campaign_id: row.campaignId,
        campaign_name: row.campaignName,
        mode: 'cascade',
        slots_moved: removed.length,
        v_fact: vFact,
        absorbed: outcome.absorbed,
        residual: vFact - outcome.absorbed,
      });
    } else {
      // Mid-flight: E6 owns re-placement (future-only, hourly). The day's value joins the
      // stored reliquat, which the next round validates on the TOTAL and places.
      await tx
        .update(campaignDispatchPlan)
        .set({ reliquatStocke: sql`${campaignDispatchPlan.reliquatStocke} + ${vFact}` })
        .where(eq(campaignDispatchPlan.id, row.plan.id));
      moved.push({
        campaign_id: row.campaignId,
        campaign_name: row.campaignName,
        mode: 'reliquat',
        slots_moved: removed.length,
        v_fact: vFact,
        absorbed: 0,
        residual: vFact,
      });
    }
  }
  return moved;
};

const round3 = (n: number): number => Math.round(n * 1000) / 1000;

/**
 * HOUR-UNAV1 ruling 8.2, carried by DEACT-1 — the venue's FUTURE event slots (live positionings,
 * ACCEPTE / EN_ATTENTE, match not annulé) whose hours are in scope leave its allocation, and their
 * value goes back through the event refusal cascade — the same repair an owner's refusal runs. The
 * venue keeps its other slots (impressions and value pro rata); an allocation left with none is a
 * refusal (REFUSE, no money). The venue's holds for the event are rewritten from what it keeps.
 */
const moveEventSlots = async (
  tx: Tx,
  venueId: string,
  inScope: (c: { date: string; hour: number }) => boolean,
  now: Date,
): Promise<RedispatchedShare[]> => {
  const rows = await tx
    .select({
      allocation: eventAllocations,
      campaignId: campaigns.id,
      campaignName: campaigns.name,
      eventMinutes: campaigns.eventMinutes,
      standardCpmTnd: campaigns.standardCpmTnd,
      eventCpmTnd: campaigns.eventCpmTnd,
      eventId: events.id,
      kickoffAt: events.kickoffAt,
      endsAt: events.endsAt,
    })
    .from(eventAllocations)
    .innerJoin(campaigns, eq(eventAllocations.campaignId, campaigns.id))
    .innerJoin(events, eq(campaigns.eventId, events.id))
    .where(
      and(
        eq(eventAllocations.screenhostId, venueId),
        inArray(eventAllocations.statut, ['ACCEPTE', 'EN_ATTENTE']),
        inArray(campaigns.status, ['pending', 'upcoming', 'active']),
        eq(events.annule, false),
      ),
    )
    .for('update', { of: eventAllocations });

  const moved: RedispatchedShare[] = [];
  for (const row of rows) {
    const blocs = parseBlocs(row.allocation.blocs);
    const touches = (b: { start: string; end: string }) =>
      new Date(b.start).getTime() > now.getTime() &&
      blocCells(new Date(b.start), new Date(b.end)).some(inScope);
    const hit = blocs.filter(touches);
    if (hit.length === 0) continue;
    const kept = blocs.filter((b) => !touches(b));
    const total = row.allocation.impressionsTotal;
    const removedImpressions = hit.reduce((sum, b) => sum + b.impressions, 0);
    const montant = Number(row.allocation.montantTnd);
    const removedMontant =
      kept.length === 0 || total <= 0 ? montant : round3((montant * removedImpressions) / total);

    await tx
      .update(eventAllocations)
      .set(
        kept.length === 0
          ? { statut: 'REFUSE', decidedAt: now }
          : {
              blocs: kept,
              impressionsTotal: Math.max(0, total - removedImpressions),
              montantTnd: Math.max(0, montant - removedMontant).toFixed(3),
            },
      )
      .where(eq(eventAllocations.id, row.allocation.id));
    // The venue's holds for this event follow what its live allocations still hold.
    await releaseBlocHours(tx, row.eventId, venueId);
    const stillLive = await tx
      .select({ blocs: eventAllocations.blocs })
      .from(eventAllocations)
      .innerJoin(campaigns, eq(eventAllocations.campaignId, campaigns.id))
      .where(
        and(
          eq(eventAllocations.screenhostId, venueId),
          eq(campaigns.eventId, row.eventId),
          inArray(eventAllocations.statut, ['ACCEPTE', 'EN_ATTENTE']),
        ),
      );
    for (const live of stillLive) {
      await reserveBlocHours(tx, row.eventId, venueId, parseBlocs(live.blocs));
    }

    const outcome = await runEventRefusalCascade(
      tx,
      { id: row.campaignId, name: row.campaignName, eventMinutes: row.eventMinutes },
      { id: row.eventId, kickoffAt: row.kickoffAt, endsAt: row.endsAt },
      {
        screenhostId: venueId,
        impressionsTotal: removedImpressions,
        minutes: hit.length,
        montantTnd: removedMontant,
      },
      campaignCpmRates(row).eventCpmTnd,
    );
    const placed =
      outcome.allocationIds.length === 0
        ? 0
        : (
            await tx
              .select({ impressions: eventAllocations.impressionsTotal })
              .from(eventAllocations)
              .where(inArray(eventAllocations.id, outcome.allocationIds))
          ).reduce((sum, a) => sum + a.impressions, 0);
    const absorbed = Math.min(removedImpressions, placed);
    moved.push({
      campaign_id: row.campaignId,
      campaign_name: row.campaignName,
      mode: 'evenement',
      slots_moved: hit.length,
      v_fact: removedImpressions,
      absorbed,
      residual: removedImpressions - absorbed,
    });
  }
  return moved;
};
