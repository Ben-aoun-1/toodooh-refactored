import { and, eq, inArray, sql } from 'drizzle-orm';

import { db } from '../../db/client.js';
import {
  campaignDispatchAllocation,
  campaignDispatchPlan,
  campaigns,
  creatives,
  eventAllocations,
  proofOfPlay,
  screenhostAffluence,
  screenhostAffluenceHourly,
  screenhosts,
  screens,
} from '../../db/schema.js';
import { decideAllocation } from '../../lib/allocation-decision.js';
import { decideEventAllocation } from '../../lib/event-allocation-decision.js';
import { collapseHalvesSql, inEffectSql } from '../../lib/half-hour-slots.js';
import { isOpenAt } from '../../lib/opening-hours.js';
import { activeAllocationsForScreenhost } from '../../lib/playout/active-allocations.js';
import { createRng } from '../world/rng.js';

import { type VirtualMoment, withinHour } from './clock.js';

// SIM-2 — the four emulated actors of one virtual hour. Each is deterministic: its rng stream is
// seeded by (world seed, the virtual instant, the entity), so replaying the same world from the
// same clock produces the same hour. None of them re-implements an engine — they produce exactly
// the inputs the real engines consume: an owner's decision goes through lib/allocation-decision
// (the product route's own transaction, cascade included), a played spot is a proof_of_play row
// resolved through the REAL airability gate, footfall is a screenhost_affluence_hourly cell.

export interface OwnerBehaviour {
  acceptanceRate: number;
  responseDelayHours: number;
}

export interface OwnerAnswers {
  answered: number;
  accepted: number;
  refused: number;
}

/**
 * Owners answer the proposals sitting in front of them. The delay is MEMORYLESS: each waiting
 * proposal is answered this hour with probability 1/response_delay_hours, which gives the owner's
 * configured mean delay without needing to know when the proposal appeared — the allocation's
 * created_at is stamped by the REAL clock (the engines write it), so it cannot be compared with a
 * virtual instant that may sit months away.
 */
export const runOwnerAnswers = async (input: {
  moment: VirtualMoment;
  seed: string;
  behaviours: Map<string, OwnerBehaviour>;
}): Promise<OwnerAnswers> => {
  const rows = await db
    .select({
      allocationId: campaignDispatchAllocation.id,
      ownerId: screenhosts.ownerId,
    })
    .from(campaignDispatchAllocation)
    .innerJoin(screenhosts, eq(screenhosts.id, campaignDispatchAllocation.screenhostId))
    .innerJoin(campaignDispatchPlan, eq(campaignDispatchPlan.id, campaignDispatchAllocation.planId))
    .innerJoin(campaigns, eq(campaigns.id, campaignDispatchPlan.campaignId))
    .where(
      and(
        eq(campaignDispatchAllocation.statutAcceptation, 'EN_ATTENTE'),
        inArray(campaigns.status, ['pending', 'upcoming', 'active']),
      ),
    )
    .orderBy(campaignDispatchAllocation.screenhostId, campaignDispatchAllocation.id);

  const result: OwnerAnswers = { answered: 0, accepted: 0, refused: 0 };
  let index = 0;
  for (const row of rows) {
    index += 1;
    if (!row.ownerId) continue;
    const behaviour = input.behaviours.get(row.ownerId);
    if (!behaviour) continue;
    // Seeded by POSITION, never by the allocation's id: ids are database-generated and random,
    // and a world whose owners answer differently on a replay is not reproducible.
    const rng = createRng(`${input.seed}:${input.moment.at.toISOString()}:${index}`);
    const answersNow = rng.next() < 1 / Math.max(1, behaviour.responseDelayHours);
    if (!answersNow) continue;
    const statut = rng.next() < behaviour.acceptanceRate ? 'ACCEPTE' : 'REFUSE';
    const outcome = await decideAllocation({
      allocationId: row.allocationId,
      ownerId: row.ownerId,
      statut,
    });
    if (outcome.kind === 'ok' && outcome.changed) {
      result.answered += 1;
      if (statut === 'ACCEPTE') result.accepted += 1;
      else result.refused += 1;
    }
  }
  return result;
};

/**
 * The same owners, answering their EVENT proposals — the event module keeps its own allocation
 * table and its own cascade (a refusal releases the venue's reserved bloc hours before the share
 * is re-placed), so it gets its own pass through the product's own decision path.
 */
export const runEventOwnerAnswers = async (input: {
  moment: VirtualMoment;
  seed: string;
  behaviours: Map<string, OwnerBehaviour>;
}): Promise<OwnerAnswers> => {
  const rows = await db
    .select({ allocationId: eventAllocations.id, ownerId: screenhosts.ownerId })
    .from(eventAllocations)
    .innerJoin(screenhosts, eq(screenhosts.id, eventAllocations.screenhostId))
    .where(eq(eventAllocations.statut, 'EN_ATTENTE'))
    .orderBy(eventAllocations.screenhostId, eventAllocations.id);

  const result: OwnerAnswers = { answered: 0, accepted: 0, refused: 0 };
  let index = 0;
  for (const row of rows) {
    index += 1;
    if (!row.ownerId) continue;
    const behaviour = input.behaviours.get(row.ownerId);
    if (!behaviour) continue;
    const rng = createRng(`${input.seed}:${input.moment.at.toISOString()}:evt:${index}`);
    if (rng.next() >= 1 / Math.max(1, behaviour.responseDelayHours)) continue;
    const statut = rng.next() < behaviour.acceptanceRate ? 'ACCEPTE' : 'REFUSE';
    const outcome = await decideEventAllocation({
      allocationId: row.allocationId,
      ownerId: row.ownerId,
      statut,
      now: input.moment.at,
    });
    if (outcome.kind === 'ok' && outcome.changed) {
      result.answered += 1;
      if (statut === 'ACCEPTE') result.accepted += 1;
      else result.refused += 1;
    }
  }
  return result;
};

export interface ScreenLiveness {
  online: number;
  offline: number;
  /** venue id → the ids of its screens that are lit this hour. */
  onlineByVenue: Map<string, string[]>;
}

/** Screens heartbeat — or stay dark for the hour, with their configured probability. */
export const runScreenLiveness = async (input: {
  moment: VirtualMoment;
  seed: string;
  offlineProbability: Map<string, number>;
}): Promise<ScreenLiveness> => {
  const rows = await db
    .select({ id: screens.id, screenhostId: screens.screenhostId })
    .from(screens)
    .where(eq(screens.isActive, true));

  const onlineByVenue = new Map<string, string[]>();
  const onlineIds: string[] = [];
  let offline = 0;
  for (const row of rows) {
    const p = input.offlineProbability.get(row.id) ?? 0;
    const rng = createRng(`${input.seed}:${input.moment.at.toISOString()}:${row.id}`);
    if (rng.next() < p) {
      offline += 1;
      continue;
    }
    onlineIds.push(row.id);
    const list = onlineByVenue.get(row.screenhostId) ?? [];
    list.push(row.id);
    onlineByVenue.set(row.screenhostId, list);
  }
  if (onlineIds.length > 0) {
    // Stamped at the END of the hour: a screen heartbeats all hour long, and the clock stands at
    // the NEXT hour once the tick returns — stamping the hour's start would make every screen
    // look 60 minutes stale (dead, past the 12-minute tolerance) the moment a tick finished.
    await db
      .update(screens)
      .set({ lastSeenAt: withinHour(input.moment.at, 59) })
      .where(inArray(screens.id, onlineIds));
  }
  return { online: onlineIds.length, offline, onlineByVenue };
};

/**
 * The PAX sensors report the hour that just passed: one MEASURED cell per open venue, both
 * half-hour halves carrying the same level (the slice-C rule), derived from the venue's own
 * typical week with an hourly jitter. Cells land in screenhost_affluence_hourly — the very table
 * the hub's ingest writes and the audience engines read.
 */
export const runPax = async (input: {
  moment: VirtualMoment;
  seed: string;
  onlineByVenue: Map<string, string[]>;
}): Promise<number> => {
  const venues = await db
    .select({
      id: screenhosts.id,
      openingHour: screenhosts.openingHour,
      closingHour: screenhosts.closingHour,
    })
    .from(screenhosts)
    .where(eq(screenhosts.isActive, true));
  const open = venues.filter((v) => isOpenAt(input.moment.hour, v.openingHour, v.closingHour));
  if (open.length === 0) return 0;

  // HOUR-AVG1 — the hour's base is the AVERAGE of its two half-hour grid cells.
  const grid = await db
    .select({
      screenhostId: screenhostAffluence.screenhostId,
      value: collapseHalvesSql(screenhostAffluence.estimatedImpressions),
    })
    .from(screenhostAffluence)
    .where(
      and(
        eq(screenhostAffluence.dayOfWeek, input.moment.dayOfWeek),
        eq(screenhostAffluence.hour, input.moment.hour),
        inEffectSql(screenhostAffluence.inEffect),
        inArray(
          screenhostAffluence.screenhostId,
          open.map((v) => v.id),
        ),
      ),
    )
    .groupBy(screenhostAffluence.screenhostId);
  const baseOf = new Map(grid.map((g) => [g.screenhostId, g.value]));

  const rows = open.flatMap((venue) => {
    const rng = createRng(`${input.seed}:${input.moment.at.toISOString()}:pax:${venue.id}`);
    const base = baseOf.get(venue.id) ?? 0;
    const value = Math.max(0, Math.round(base * rng.float(0.8, 1.2)));
    const deviceOnline = (input.onlineByVenue.get(venue.id) ?? []).length > 0;
    return [input.moment.hour * 2, input.moment.hour * 2 + 1].map((slot) => ({
      screenhostId: venue.id,
      date: input.moment.date,
      hour: input.moment.hour,
      slot,
      value,
      deviceOnline,
      receivedAt: input.moment.at,
    }));
  });

  await db
    .insert(screenhostAffluenceHourly)
    .values(rows)
    .onConflictDoUpdate({
      target: [
        screenhostAffluenceHourly.screenhostId,
        screenhostAffluenceHourly.date,
        screenhostAffluenceHourly.slot,
      ],
      set: {
        value: sql`excluded.value`,
        deviceOnline: sql`excluded.device_online`,
        receivedAt: sql`excluded.received_at`,
      },
    });
  return rows.length;
};

export interface PlayoutResult {
  proofs: number;
  venuesAiring: number;
  skippedOffline: number;
}

/**
 * The screens play what the frozen plan says they should, this hour. A spot becomes a
 * proof_of_play row ONLY if the REAL airability gate (activeAllocationsForScreenhost — ACCEPTE +
 * campaign active + creative approved + window covers now) lets it: the simulator emulates the
 * transport, never the rule. A venue with no lit screen plays nothing, which is exactly the
 * manquement the redispatch engine is meant to notice.
 */
export const runPlayout = async (input: {
  moment: VirtualMoment;
  onlineByVenue: Map<string, string[]>;
}): Promise<PlayoutResult> => {
  const rows = await db
    .select({
      screenhostId: campaignDispatchAllocation.screenhostId,
      creneaux: campaignDispatchAllocation.creneaux,
      campaignId: campaigns.id,
    })
    .from(campaignDispatchAllocation)
    .innerJoin(campaignDispatchPlan, eq(campaignDispatchPlan.id, campaignDispatchAllocation.planId))
    .innerJoin(campaigns, eq(campaigns.id, campaignDispatchPlan.campaignId))
    .innerJoin(creatives, eq(creatives.id, campaigns.creativeId))
    .where(
      and(
        eq(campaignDispatchAllocation.statutAcceptation, 'ACCEPTE'),
        eq(campaigns.status, 'active'),
        eq(creatives.validationStatus, 'approved'),
      ),
    );

  const result: PlayoutResult = { proofs: 0, venuesAiring: 0, skippedOffline: 0 };
  const airing = new Set<string>();
  for (const row of rows) {
    const slot = row.creneaux.find(
      (c) => c.date === input.moment.date && c.hour === input.moment.hour,
    );
    if (!slot || slot.reps <= 0) continue;
    const lit = input.onlineByVenue.get(row.screenhostId) ?? [];
    if (lit.length === 0) {
      result.skippedOffline += 1;
      continue;
    }
    const [authorized] = await activeAllocationsForScreenhost(
      row.screenhostId,
      input.moment.at,
      row.campaignId,
    );
    if (!authorized) continue;

    const screenId = lit[0]!;
    const duration = authorized.durationSeconds ?? 10;
    const proofs = Array.from({ length: slot.reps }, (_, i) => ({
      screenId,
      screenhostId: row.screenhostId,
      campaignId: authorized.campaignId,
      creativeId: authorized.creativeId,
      videoIdAsSent: authorized.campaignId,
      eventType: 'VIDEO_ENDED' as const,
      playedDurationMs: duration * 1000,
      eventTs: withinHour(input.moment.at, Math.floor((60 / slot.reps) * i)),
      receivedAt: withinHour(input.moment.at, Math.floor((60 / slot.reps) * i)),
    }));
    await db.insert(proofOfPlay).values(proofs);
    result.proofs += proofs.length;
    airing.add(row.screenhostId);
  }
  result.venuesAiring = airing.size;
  return result;
};
