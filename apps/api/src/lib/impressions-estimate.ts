import { and, eq, ne } from 'drizzle-orm';

import { db } from '../db/client.js';
import {
  campaignDispatchAllocation,
  campaignDispatchPlan,
  eventAllocations,
  events,
} from '../db/schema.js';

import { deriveICible } from './activation-service.js';
import {
  campaignCpmRates,
  campaignTTiers,
  cpmForCampaign,
  getDispatchConfig,
} from './dispatch/config.js';
import { planFromPool } from './dispatch/plan-outcome.js';
import { assemblePool } from './dispatch/pool.js';
import { seuilImpressions, tForDuration } from './dispatch/thresholds.js';
import { buildWindowDays } from './dispatch/window.js';
import { assembleEventPool, fillEventBlocs } from './event-dispatch/dispatch.js';

// IMP-EST1 (operator 2026-09-22, ruled Q1 A · Q2 A · Q3 A) — « Impressions estimées » is a
// READ-ONLY DRY-RUN of the real dispatch at this moment, never ⌊budget × 1000 ÷ CPM⌋:
//
//   • a standard campaign runs runDispatch's own machinery — assemblePool (the live semaine type,
//     occupancy, zones, targeting, declared days, installed screens) then ./dispatch/plan-outcome
//     (buildPlan + the clôtures), at the campaign's OWN CPM and T tiers — and answers
//     Σ allocations Σ créneau.impressions: exactly what « prédites » would read if the campaign were
//     dispatched now. UNIT: PHYSICAL impressions (lib/impressions-display.ts), not facturable.
//   • an event positioning runs the EVENT engine's pool + fill (lib/event-dispatch) for its budget:
//     Σ placed blocs (A_max × 20 per 20-min bloc, whole blocs).
//   • an already-dispatched campaign reads its real plan instead of simulating.
//
// NOTHING IS WRITTEN on the classic path: assemblePool runs on the plain executor (no transaction,
// so no advisory lock outlives the request), the journal is the no-op collector, and neither the
// plan nor an allocation, a reservation or a notification is inserted. On the event path the only
// write is the one GET /:id/cmax already makes for the same positioning: computeAmax's A_max
// ratchet (a monotone MAX(grid, stored) — the event pool's own read, lib/event-pricing).
//
// A refusal is a STATUS, never a number: the caller renders « — » with its reason.

/** The campaign row the estimate reads (the route selects exactly these, owner-scoped). */
export interface EstimateCampaign {
  id: string;
  campaignType: string;
  eventId: string | null;
  startDate: string | null;
  endDate: string | null;
  requestedBudget: string | null;
  standardCpmTnd: string;
  eventCpmTnd: string;
  t10s: string;
  t20s: string;
  t30s: string;
  /** The linked creative's duration S (seconds); null = no creative or no duration. */
  spotSeconds: number | null;
}

export type EstimateRefusal =
  | 'NO_DATES'
  | 'NO_BUDGET'
  | 'BUDGET_TOO_LOW'
  | 'NO_CREATIVE'
  | 'NO_ELIGIBLE'
  | 'SATURATED'
  | 'TOO_THIN'
  | 'EVENT_CANCELLED';

export type ImpressionsEstimate =
  | {
      status: 'OK';
      /** SIMULATION = the dry-run; PLAN = the campaign is already dispatched (its real plan). */
      source: 'SIMULATION' | 'PLAN';
      impressions: number;
      /** Venues the (simulated or real) dispatch places the campaign on. */
      venuesCount: number;
      /** Calendar days of the window (inclusive); null for a positioning (the event's window). */
      daysCount: number | null;
    }
  | { status: EstimateRefusal };

/** Σ allocations Σ créneau.impressions — « prédites », the ONE sum for a simulated or frozen plan. */
export const predictedImpressions = (
  allocations: readonly { creneaux: readonly { impressions: number }[] }[],
): number =>
  allocations.reduce((sum, a) => sum + a.creneaux.reduce((s, c) => s + c.impressions, 0), 0);

const windowDaysCount = (c: EstimateCampaign): number | null =>
  c.startDate && c.endDate ? buildWindowDays(c.startDate, c.endDate).length : null;

/** The positive budget the estimate sizes with (the caller's override, else the row's), or null. */
const budgetOf = (c: EstimateCampaign, override: number | undefined): number | null => {
  const budget = override ?? (c.requestedBudget === null ? null : Number(c.requestedBudget));
  return budget !== null && Number.isFinite(budget) && budget > 0 ? budget : null;
};

// A dispatched classic campaign: its frozen plan's prédites. A REFUSE allocation never airs (its
// share was re-placed by the refusal cascade), so it is left out.
const frozenPlanEstimate = async (c: EstimateCampaign): Promise<ImpressionsEstimate | null> => {
  const [plan] = await db
    .select({ id: campaignDispatchPlan.id })
    .from(campaignDispatchPlan)
    .where(eq(campaignDispatchPlan.campaignId, c.id))
    .limit(1);
  if (!plan) return null;
  const allocations = await db
    .select({ creneaux: campaignDispatchAllocation.creneaux })
    .from(campaignDispatchAllocation)
    .where(
      and(
        eq(campaignDispatchAllocation.planId, plan.id),
        ne(campaignDispatchAllocation.statutAcceptation, 'REFUSE'),
      ),
    );
  return {
    status: 'OK',
    source: 'PLAN',
    impressions: predictedImpressions(allocations),
    venuesCount: allocations.length,
    daysCount: windowDaysCount(c),
  };
};

const classicEstimate = async (
  c: EstimateCampaign,
  budgetOverride: number | undefined,
): Promise<ImpressionsEstimate> => {
  const frozen = await frozenPlanEstimate(c);
  if (frozen) return frozen;

  if (!c.startDate || !c.endDate) return { status: 'NO_DATES' };
  const budget = budgetOf(c, budgetOverride);
  if (budget === null) return { status: 'NO_BUDGET' };
  if (c.spotSeconds === null || c.spotSeconds <= 0) return { status: 'NO_CREATIVE' };

  // The activation derivation, verbatim (lib/activation-service): the campaign's OWN CPM (CPM-1/3)
  // and T tiers (CPM-2); the live config supplies only F, G and R_min — exactly runDispatch.
  const cpm = cpmForCampaign(c.campaignType, campaignCpmRates(c));
  const iCible = deriveICible(budget, cpm);
  if (iCible === null) return { status: 'BUDGET_TOO_LOW' };
  const s = c.spotSeconds;
  const config = await getDispatchConfig();
  const t = tForDuration(s, campaignTTiers(c));
  const seuil = seuilImpressions(cpm);

  // Read-only assembly: the plain executor, no occupancy lock, the no-op journal.
  const assembled = await assemblePool(
    db,
    { id: c.id, startDate: c.startDate, endDate: c.endDate },
    { s, t, fMaxSeconds: config.fMaxSeconds },
  );
  const planned = planFromPool({ iCible, cpm, s, t, seuil }, config, assembled);
  if (planned.status === 'TOO_THIN') return { status: 'TOO_THIN' };
  if (planned.status === 'NO_ELIGIBLE') {
    return { status: planned.saturated ? 'SATURATED' : 'NO_ELIGIBLE' };
  }
  return {
    status: 'OK',
    source: 'SIMULATION',
    impressions: predictedImpressions(planned.built.allocations),
    venuesCount: planned.built.allocations.length,
    daysCount: assembled.windowDays.length,
  };
};

const eventEstimate = async (
  c: EstimateCampaign,
  eventId: string,
  budgetOverride: number | undefined,
): Promise<ImpressionsEstimate> => {
  // A dispatched positioning: its placed blocs (runEventDispatch would short-circuit on any row).
  const placed = await db
    .select({ statut: eventAllocations.statut, impressions: eventAllocations.impressionsTotal })
    .from(eventAllocations)
    .where(eq(eventAllocations.campaignId, c.id));
  if (placed.length > 0) {
    const live = placed.filter((p) => p.statut !== 'REFUSE');
    return {
      status: 'OK',
      source: 'PLAN',
      impressions: live.reduce((sum, p) => sum + p.impressions, 0),
      venuesCount: live.length,
      daysCount: null,
    };
  }

  const [ev] = await db.select().from(events).where(eq(events.id, eventId)).limit(1);
  if (!ev || ev.annule) return { status: 'EVENT_CANCELLED' };
  const budget = budgetOf(c, budgetOverride);
  if (budget === null) return { status: 'NO_BUDGET' };

  // The activation path's CPM for a positioning (cpmForCampaign on its own rates → CPM_evt).
  const cpm = cpmForCampaign(c.campaignType, campaignCpmRates(c));
  const pool = await assembleEventPool({ id: ev.id, kickoffAt: ev.kickoffAt, endsAt: ev.endsAt });
  const fill = fillEventBlocs(pool, budget, cpm);
  if (fill.status === 'NO_POOL') return { status: 'NO_ELIGIBLE' };
  // D7 — reaching I_cible would need more venues than N_max: the real validation refuses.
  if (fill.status === 'NMAX_EXCEEDED') return { status: 'TOO_THIN' };
  return {
    status: 'OK',
    source: 'SIMULATION',
    impressions: fill.placedImpressions,
    venuesCount: fill.placements.length,
    daysCount: null,
  };
};

/**
 * The « Impressions estimées » of a campaign now. `budgetTnd` overrides the stored budget (the
 * wizard's cursor, not saved yet); absent, the row's requested_budget sizes the dry-run.
 */
export const estimateCampaignImpressions = async (
  campaign: EstimateCampaign,
  opts: { budgetTnd?: number } = {},
): Promise<ImpressionsEstimate> =>
  campaign.eventId === null
    ? classicEstimate(campaign, opts.budgetTnd)
    : eventEstimate(campaign, campaign.eventId, opts.budgetTnd);
