import { and, eq, inArray, ne } from 'drizzle-orm';

import { db } from '../db/client.js';
import {
  type DispatchCreneau,
  campaignDispatchAllocation,
  campaignDispatchPlan,
  campaigns,
  creatives,
  eventAllocations,
} from '../db/schema.js';

// DUR-1 (Myriam 2026-10-20, before the Ooredoo meeting) — the screencaster dashboard's « Durée
// totale de diffusion »: the airtime the frozen plan buys, in seconds. It used to be « impressions
// prévues × 30 s », which mixed up audience with plays. Like every cast surface (CF-HF4) it reads
// the PLAN, never delivered proofs:
//   classic — Σ créneau.reps × the spot's length, over the plan's non-REFUSE allocations;
//   event   — a minutes positioning owns one 60 s seat per minute sold (EVT-MIN1), so
//             event_minutes × 60 once dispatched; a legacy positioning (no minutes) holds the
//             whole 5-minute pod of each of its blocs.
// Absent from the map = not dispatched yet (0 on the tile).

const POD_SECONDS = 5 * 60;

/** Pure: Σ reps over the créneaux × the spot's length. */
export const classicAirtimeSeconds = (
  creneaux: readonly Pick<DispatchCreneau, 'reps'>[],
  spotSeconds: number,
): number => creneaux.reduce((sum, c) => sum + Math.max(0, c.reps), 0) * Math.max(0, spotSeconds);

export const plannedAirtimeByCampaign = async (
  campaignIds: readonly string[],
): Promise<Map<string, number>> => {
  const out = new Map<string, number>();
  if (campaignIds.length === 0) return out;
  const ids = [...campaignIds];

  const classic = await db
    .select({
      campaignId: campaignDispatchPlan.campaignId,
      creneaux: campaignDispatchAllocation.creneaux,
      spotSeconds: creatives.durationSeconds,
    })
    .from(campaignDispatchAllocation)
    .innerJoin(campaignDispatchPlan, eq(campaignDispatchPlan.id, campaignDispatchAllocation.planId))
    .innerJoin(campaigns, eq(campaigns.id, campaignDispatchPlan.campaignId))
    .leftJoin(creatives, eq(creatives.id, campaigns.creativeId))
    .where(
      and(
        inArray(campaignDispatchPlan.campaignId, ids),
        ne(campaignDispatchAllocation.statutAcceptation, 'REFUSE'),
      ),
    );
  for (const r of classic) {
    const seconds = classicAirtimeSeconds(r.creneaux, r.spotSeconds ?? 0);
    out.set(r.campaignId, (out.get(r.campaignId) ?? 0) + seconds);
  }

  const events = await db
    .select({
      campaignId: eventAllocations.campaignId,
      blocs: eventAllocations.blocs,
      eventMinutes: campaigns.eventMinutes,
    })
    .from(eventAllocations)
    .innerJoin(campaigns, eq(campaigns.id, eventAllocations.campaignId))
    .where(and(inArray(eventAllocations.campaignId, ids), ne(eventAllocations.statut, 'REFUSE')));
  // A campaign has EITHER a plan OR event allocations; the plan wins if it ever did.
  const eventSeconds = new Map<string, number>();
  for (const r of events) {
    if (out.has(r.campaignId)) continue;
    const seconds =
      r.eventMinutes !== null
        ? r.eventMinutes * 60
        : (eventSeconds.get(r.campaignId) ?? 0) +
          (Array.isArray(r.blocs) ? r.blocs.length : 0) * POD_SECONDS;
    eventSeconds.set(r.campaignId, seconds);
  }
  for (const [id, seconds] of eventSeconds) out.set(id, seconds);
  return out;
};
