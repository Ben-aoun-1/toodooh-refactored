import { and, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';

import { db } from '../db/client.js';
import {
  campaignDispatchAllocation,
  campaignDispatchPlan,
  campaigns,
  eventAllocations,
  events,
  screenhosts,
  screenhostUnavailability,
  screenhostUnavailableHours,
} from '../db/schema.js';

import { notDemoCampaignSql } from './demo.js';
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
import { type Cell, cellKey, cellsForHours, openingDayCells } from './unavailable-hours.js';

// E2 / CAL-1 → HOUR-UNAV1 — declare or undeclare a venue's unavailability (a whole day or some of
// its hours), moving the live shares of the declared hours.
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
  /** HOUR-UNAV1 — 'evenement': a sold event slot in the declared hours, re-placed (event cascade). */
  mode: 'cascade' | 'reliquat' | 'evenement';
  slots_moved: number;
  v_fact: number;
  absorbed: number;
  residual: number;
}

/**
 * HOUR-UNAV1 — declare or undeclare unavailability on opening day `day`: the WHOLE day (`hours`
 * null) or some of its clock hours. Storage is normalised: a declaration that covers every hour of
 * the day is one screenhost_unavailability row (its hour rows dropped); undeclaring some hours of
 * a whole declared day leaves the other hours as hour rows. Returns null when `hours` names no
 * hour of the venue's window. Declaring moves the live shares of the declared hours: classic
 * créneaux exactly as CAL-1 (cascade / reliquat), and sold EVENT slots through the event refusal
 * cascade (ruling 8.2) — the venue keeps its slots outside the declared hours.
 */
export const setVenueUnavailability = async (
  venueId: string,
  day: string,
  hours: readonly number[] | null,
  unavailable: boolean,
  logger: FastifyBaseLogger,
): Promise<RedispatchedShare[] | null> => {
  const [venue] = await db
    .select({ openingHour: screenhosts.openingHour, closingHour: screenhosts.closingHour })
    .from(screenhosts)
    .where(eq(screenhosts.id, venueId))
    .limit(1);
  const openingHour = venue?.openingHour ?? null;
  const closingHour = venue?.closingHour ?? null;
  const dayCells = openingDayCells(day, openingHour, closingHour);
  const cells = hours === null ? dayCells : cellsForHours(day, hours, openingHour, closingHour);
  if (cells === null) return null;
  const keys = new Set(cells.map((c) => cellKey(c.date, c.hour)));
  const whole = dayCells.every((c) => keys.has(cellKey(c.date, c.hour)));

  const dropHourRows = async (tx: Tx, which: readonly Cell[]): Promise<void> => {
    for (const c of which) {
      await tx
        .delete(screenhostUnavailableHours)
        .where(
          and(
            eq(screenhostUnavailableHours.screenhostId, venueId),
            eq(screenhostUnavailableHours.day, c.date),
            eq(screenhostUnavailableHours.hour, c.hour),
          ),
        );
    }
  };

  if (!unavailable) {
    await db.transaction(async (tx) => {
      const removedDay = await tx
        .delete(screenhostUnavailability)
        .where(
          and(
            eq(screenhostUnavailability.screenhostId, venueId),
            eq(screenhostUnavailability.day, day),
          ),
        )
        .returning({ id: screenhostUnavailability.id });
      // A whole declared day minus some hours: its OTHER hours stay unavailable, as hour rows.
      if (removedDay.length > 0 && !whole) {
        const rest = dayCells.filter((c) => !keys.has(cellKey(c.date, c.hour)));
        if (rest.length > 0) {
          await tx
            .insert(screenhostUnavailableHours)
            .values(rest.map((c) => ({ screenhostId: venueId, day: c.date, hour: c.hour })))
            .onConflictDoNothing();
        }
      }
      await dropHourRows(tx, cells);
    });
    return [];
  }

  const dates = cells.map((c) => c.date).sort();
  const firstDate = dates[0] ?? day;
  const lastDate = dates[dates.length - 1] ?? day;

  // LOG1 — one cascade trace per re-placed campaign, flushed after the tx on both outcomes.
  const traces: EngineTrace[] = [];
  const redispatched = await db
    .transaction(async (tx) => {
      // The declaration FIRST, so the cascades' pool assembly already excludes these hours.
      if (whole) {
        await tx
          .insert(screenhostUnavailability)
          .values({ screenhostId: venueId, day })
          .onConflictDoNothing();
        await dropHourRows(tx, dayCells);
      } else {
        await tx
          .insert(screenhostUnavailableHours)
          .values(cells.map((c) => ({ screenhostId: venueId, day: c.date, hour: c.hour })))
          .onConflictDoNothing();
      }

      return moveVenueShares(
        tx,
        venueId,
        (c) => keys.has(cellKey(c.date, c.hour)),
        { firstDate, lastDate },
        traces,
        new Date(),
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
 * Moves this venue's live shares off the clock cells `inScope` selects, within the campaign window
 * [firstDate, lastDate]: classic créneaux exactly as CAL-1 (pending / upcoming → refusal cascade;
 * active → the stored reliquat E6 re-places), and sold EVENT slots through the event refusal
 * cascade. Shared by a declared unavailability (HOUR-UNAV1: the declared hours) and an account
 * deactivation (DEACT-1: every future hour). The caller has already made the venue ineligible
 * (declaration rows / owner status) in the same transaction, so no cascade lands back on it.
 */
export const moveVenueShares = async (
  tx: Tx,
  venueId: string,
  inScope: (c: { date: string; hour: number }) => boolean,
  window: { firstDate: string; lastDate: string },
  traces: EngineTrace[],
  now: Date,
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
  // HOUR-UNAV1 (ruling 8.2) — sold event slots inside the declared hours are re-placed too.
  moved.push(...(await moveEventSlots(tx, venueId, inScope, now)));
  return moved;
};

const round3 = (n: number): number => Math.round(n * 1000) / 1000;

/**
 * HOUR-UNAV1 (ruling 8.2) — the venue's FUTURE event slots (live positionings, ACCEPTE /
 * EN_ATTENTE, match not annulé) whose hours touch the declaration leave its allocation, and their
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
      seatMinutes: events.seatMinutes,
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
        // DEMO-3 — a demo positioning airs on its own timeline and is never re-placed.
        notDemoCampaignSql(),
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
      {
        id: row.eventId,
        kickoffAt: row.kickoffAt,
        endsAt: row.endsAt,
        seatMinutes: row.seatMinutes,
      },
      {
        screenhostId: venueId,
        impressionsTotal: removedImpressions,
        seats: hit.length,
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
