import { and, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';

import { db } from '../db/client.js';
import {
  campaignDispatchAllocation,
  campaignDispatchPlan,
  campaigns,
  screenhostUnavailability,
} from '../db/schema.js';

import { runRefusalCascade } from './dispatch/cascade.js';
import { createEngineTrace, type EngineTrace } from './engine-journal/trace.js';
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
  mode: 'cascade' | 'reliquat';
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

      // The colliding shares: this venue's live allocations whose campaign window covers the day
      // and whose frozen créneaux touch it. Plans locked FOR UPDATE — E6 rounds and cascades
      // serialize on the plan row (redispatch.ts idiom).
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
        .innerJoin(
          campaignDispatchPlan,
          eq(campaignDispatchAllocation.planId, campaignDispatchPlan.id),
        )
        .innerJoin(campaigns, eq(campaignDispatchPlan.campaignId, campaigns.id))
        .where(
          and(
            eq(campaignDispatchAllocation.screenhostId, venueId),
            inArray(campaignDispatchAllocation.statutAcceptation, ['ACCEPTE', 'EN_ATTENTE']),
            inArray(campaigns.status, ['pending', 'upcoming', 'active']),
            lte(campaigns.startDate, day),
            gte(campaigns.endDate, day),
          ),
        )
        .for('update', { of: campaignDispatchPlan });

      const moved: RedispatchedShare[] = [];
      for (const row of rows) {
        const removed = row.allocation.creneaux.filter((c) => c.date === day);
        if (removed.length === 0) continue;
        const kept = row.allocation.creneaux.filter((c) => c.date !== day);
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
