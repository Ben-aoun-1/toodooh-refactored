import { eq } from 'drizzle-orm';

import { db } from '../db/client.js';
import {
  businessSectors,
  campaignDispatchAllocation,
  campaignDispatchPlan,
  campaigns,
  creatives,
  eventAllocations,
  events,
  screenhosts,
} from '../db/schema.js';

import { ownerApprovedSql } from './approved-owner.js';
import {
  campaignCpmRates,
  campaignTTiers,
  cpmForCampaign,
  getDispatchConfig,
} from './dispatch/config.js';
import { assemblePool } from './dispatch/pool.js';
import { tForDuration } from './dispatch/thresholds.js';
import type { EngineTrace } from './engine-journal/trace.js';
import { computeEventCmax } from './event-pricing/pricing.js';

// ELIG-1 (Meriam 15/09, « bloquant pour le testing ») — which venues a campaign can reach, AT ANY
// STATUS (brouillon, en attente, à venir, active…), and why the others are out.
//
// Nothing is recomputed here. A standard campaign runs the REAL pool assembly read-only — the
// same call the C_max ceiling makes, with the same self-exclusion of its own frozen allocations —
// and the exclusion reasons are the engine's own: pool assembly already emits one
// `venue_excluded` event per rejected venue for the engine journal, so a collecting trace simply
// listens to them. An event positioning runs the REAL event ceiling. So this view cannot
// disagree with what dispatch would do at this instant.
//
// ELIG-2 (operator ruling 2026-09-16) — a venue whose owner is not approved (pending, rejected,
// banned, or no owner) is out of both engines, and BOTH branches name it 'owner_not_approved'
// before any other reason: the standard branch hears it from the pool's journal, the event branch
// reads the same shared predicate (lib/approved-owner.ts) on the label row.

/** A draft without a spot yet is priced like the most common spot length. */
export const DEFAULT_SPOT_SECONDS = 10;

export type ExclusionReason =
  | 'excluded'
  | 'capacity_missing'
  | 'hours_missing'
  | 'targeting_mismatch'
  | 'zone_mismatch'
  | 'inactive'
  | 'no_available_days'
  | 'no_residual_capacity'
  | 'not_event_eligible'
  | 'no_bloc_available'
  | 'no_sector'
  | 'owner_not_approved';

export interface EligibleHost {
  id: string;
  name: string;
  sector: string | null;
  class: string | null;
  sps: number;
  /** Standard: mean affluence per open hour over the window. Event: A_max (pers/h). */
  affluence: number;
  /** Standard: broadcastable hours over the window. Event: available blocs. */
  hours: number;
  /** Facturable impressions this venue can carry for this campaign. */
  capacity: number;
  days_available: number | null;
  allocation: { statut: string; impressions: number } | null;
}

export interface ExcludedHost {
  id: string;
  name: string;
  reason: ExclusionReason;
}

export interface EligibleHostsReport {
  kind: 'standard' | 'event';
  campaign: { id: string; name: string; status: string };
  window: { start: string; end: string } | null;
  spot_seconds: number;
  spot_source: 'creative' | 'default';
  cpm_tnd: number;
  eligible: EligibleHost[];
  excluded: ExcludedHost[];
  totals: {
    active_venues: number;
    eligible: number;
    excluded: number;
    capacity: number;
    c_max_tnd: number;
  };
}

export type EligibleHostsResult =
  | { status: 'OK'; report: EligibleHostsReport }
  | { status: 'NOT_FOUND' }
  | { status: 'NO_DATES' };

const KNOWN_REASONS = new Set<string>([
  'excluded',
  'capacity_missing',
  'hours_missing',
  'targeting_mismatch',
  'zone_mismatch',
  'inactive',
  'no_available_days',
  'no_residual_capacity',
  'owner_not_approved',
]);

/** An in-memory journal: listens to the pool's own `venue_excluded` events, writes nothing. */
const collectingTrace = (): { trace: EngineTrace; excluded: Map<string, ExclusionReason> } => {
  const excluded = new Map<string, ExclusionReason>();
  return {
    excluded,
    trace: {
      enabled: true,
      event(type, payload = {}, screenhostId = null) {
        if (type !== 'venue_excluded' || !screenhostId) return;
        const reason = payload['reason'];
        if (
          typeof reason === 'string' &&
          KNOWN_REASONS.has(reason) &&
          !excluded.has(screenhostId)
        ) {
          excluded.set(screenhostId, reason as ExclusionReason);
        }
      },
      finish: async () => undefined,
    },
  };
};

interface VenueLabel {
  id: string;
  name: string;
  sector: string | null;
  class: string | null;
  sps: number;
  isActive: boolean;
  ownerApproved: boolean;
  eventEligible: boolean | null;
}

const loadVenueLabels = async (): Promise<Map<string, VenueLabel>> => {
  const rows = await db
    .select({
      id: screenhosts.id,
      name: screenhosts.name,
      sector: businessSectors.name,
      eventEligible: businessSectors.eventEligible,
      class: screenhosts.class,
      sps: screenhosts.sps,
      isActive: screenhosts.isActive,
      ownerApproved: ownerApprovedSql(),
    })
    .from(screenhosts)
    .leftJoin(businessSectors, eq(businessSectors.id, screenhosts.businessSectorId));
  return new Map(
    rows.map((r) => [
      r.id,
      {
        id: r.id,
        name: r.name,
        sector: r.sector,
        class: r.class,
        sps: Number(r.sps),
        isActive: r.isActive,
        ownerApproved: r.ownerApproved,
        eventEligible: r.eventEligible,
      },
    ]),
  );
};

const byName = <T extends { name: string }>(a: T, b: T): number =>
  a.name.localeCompare(b.name, 'fr');

export const campaignEligibleHosts = async (campaignId: string): Promise<EligibleHostsResult> => {
  const [row] = await db
    .select({
      id: campaigns.id,
      name: campaigns.name,
      status: campaigns.status,
      campaignType: campaigns.campaignType,
      startDate: campaigns.startDate,
      endDate: campaigns.endDate,
      eventId: campaigns.eventId,
      standardCpmTnd: campaigns.standardCpmTnd,
      eventCpmTnd: campaigns.eventCpmTnd,
      t10s: campaigns.t10s,
      t20s: campaigns.t20s,
      t30s: campaigns.t30s,
      spotSeconds: creatives.durationSeconds,
    })
    .from(campaigns)
    .leftJoin(creatives, eq(creatives.id, campaigns.creativeId))
    .where(eq(campaigns.id, campaignId))
    .limit(1);
  if (!row) return { status: 'NOT_FOUND' };

  const config = await getDispatchConfig();
  // CPM-1 — both branches price at the campaign's OWN CPM (CPM-3: its screencaster's, realigned
  // while a draft not yet frozen); the live config still supplies F (the event branch has no T;
  // the standard one reads the row's).
  const rates = campaignCpmRates(row);
  const spotSeconds =
    row.spotSeconds && row.spotSeconds > 0 ? row.spotSeconds : DEFAULT_SPOT_SECONDS;
  const spotSource = row.spotSeconds && row.spotSeconds > 0 ? 'creative' : 'default';
  const labels = await loadVenueLabels();
  const activeVenues = [...labels.values()].filter((v) => v.isActive).length;
  const campaignView = { id: row.id, name: row.name, status: row.status };

  // ── an event positioning: the event module's own ceiling ─────────────────────
  if (row.eventId) {
    const [event] = await db
      .select({ id: events.id, kickoffAt: events.kickoffAt, endsAt: events.endsAt })
      .from(events)
      .where(eq(events.id, row.eventId))
      .limit(1);
    if (!event) return { status: 'NOT_FOUND' };
    const cmax = await computeEventCmax(event, rates.eventCpmTnd);
    const allocations = await db
      .select({
        screenhostId: eventAllocations.screenhostId,
        statut: eventAllocations.statut,
        impressions: eventAllocations.impressionsTotal,
      })
      .from(eventAllocations)
      .where(eq(eventAllocations.campaignId, row.id));
    const allocationOf = new Map(allocations.map((a) => [a.screenhostId, a]));
    const reached = new Set(cmax.venues.map((v) => v.screenhostId));

    const eligible: EligibleHost[] = cmax.venues.map((v) => {
      const label = labels.get(v.screenhostId);
      const allocation = allocationOf.get(v.screenhostId);
      return {
        id: v.screenhostId,
        name: v.name,
        sector: label?.sector ?? null,
        class: label?.class ?? null,
        sps: label?.sps ?? 0,
        affluence: v.amaxPph,
        hours: v.blocsDisponibles,
        capacity: v.impressions,
        days_available: null,
        allocation: allocation
          ? { statut: allocation.statut, impressions: allocation.impressions }
          : null,
      };
    });
    const excluded: ExcludedHost[] = [...labels.values()]
      .filter((v) => !reached.has(v.id))
      .map((v) => ({
        id: v.id,
        name: v.name,
        reason: !v.ownerApproved
          ? 'owner_not_approved'
          : !v.isActive
            ? 'inactive'
            : v.eventEligible === null
              ? 'no_sector'
              : !v.eventEligible
                ? 'not_event_eligible'
                : 'no_bloc_available',
      }));
    return {
      status: 'OK',
      report: {
        kind: 'event',
        campaign: campaignView,
        window: {
          start: event.kickoffAt.toISOString(),
          end: event.endsAt.toISOString(),
        },
        spot_seconds: spotSeconds,
        spot_source: spotSource,
        cpm_tnd: cmax.cpmEvtTnd,
        eligible: eligible.sort(byName),
        excluded: excluded.sort(byName),
        totals: {
          active_venues: activeVenues,
          eligible: eligible.length,
          excluded: excluded.length,
          capacity: cmax.iMax,
          c_max_tnd: cmax.cMaxEvtTnd,
        },
      },
    };
  }

  // ── a standard campaign: the dispatch pool, read-only ─────────────────────────
  if (!row.startDate || !row.endDate) return { status: 'NO_DATES' };

  // Its own frozen allocations are its delivery, not competition (the C_max self-exclusion).
  const [plan] = await db
    .select({ id: campaignDispatchPlan.id })
    .from(campaignDispatchPlan)
    .where(eq(campaignDispatchPlan.campaignId, row.id))
    .limit(1);
  const ownAllocations = plan
    ? await db
        .select({
          id: campaignDispatchAllocation.id,
          screenhostId: campaignDispatchAllocation.screenhostId,
          statut: campaignDispatchAllocation.statutAcceptation,
          impressions: campaignDispatchAllocation.iiPotentiel,
        })
        .from(campaignDispatchAllocation)
        .where(eq(campaignDispatchAllocation.planId, plan.id))
    : [];
  const allocationOf = new Map(ownAllocations.map((a) => [a.screenhostId, a]));

  // CPM-2 — the attention index T from the campaign's OWN tiers (in effect when it was created).
  const t = tForDuration(spotSeconds, campaignTTiers(row));
  const cpm = cpmForCampaign(row.campaignType, rates);
  const { trace, excluded: reasons } = collectingTrace();
  const { pool } = await assemblePool(
    db,
    { id: row.id, startDate: row.startDate, endDate: row.endDate },
    { s: spotSeconds, t, fMaxSeconds: config.fMaxSeconds },
    { excludeAllocationIds: ownAllocations.map((a) => a.id), trace },
  );

  const eligible: EligibleHost[] = pool.map((entry) => {
    const label = labels.get(entry.id);
    const allocation = allocationOf.get(entry.id);
    return {
      id: entry.id,
      name: label?.name ?? entry.id,
      sector: label?.sector ?? null,
      class: label?.class ?? null,
      sps: entry.sps,
      affluence: Math.round(entry.avgAffluence * 10) / 10,
      hours: entry.hours,
      capacity: entry.residualCapacity,
      days_available: entry.days.length,
      allocation: allocation
        ? { statut: allocation.statut, impressions: allocation.impressions }
        : null,
    };
  });
  const inPool = new Set(pool.map((p) => p.id));
  const excluded: ExcludedHost[] = [...labels.values()]
    .filter((v) => !inPool.has(v.id))
    .map((v) => ({
      id: v.id,
      name: v.name,
      // The engine's own reason; a venue the pool never looked at (inactive and outside the
      // targeting) keeps the plainest truthful label — its owner's status first (ELIG-2).
      reason:
        reasons.get(v.id) ??
        (!v.ownerApproved ? 'owner_not_approved' : v.isActive ? 'targeting_mismatch' : 'inactive'),
    }));
  const capacity = pool.reduce((sum, p) => sum + p.residualCapacity, 0);

  return {
    status: 'OK',
    report: {
      kind: 'standard',
      campaign: campaignView,
      window: { start: row.startDate, end: row.endDate },
      spot_seconds: spotSeconds,
      spot_source: spotSource,
      cpm_tnd: cpm,
      eligible: eligible.sort(byName),
      excluded: excluded.sort(byName),
      totals: {
        active_venues: activeVenues,
        eligible: eligible.length,
        excluded: excluded.length,
        capacity,
        c_max_tnd: Math.floor((cpm * capacity) / 1000),
      },
    },
  };
};
