import { fromZonedTime } from 'date-fns-tz';
import { and, desc, eq, sql } from 'drizzle-orm';

import { db } from '../../db/client.js';
import {
  type Campaign,
  campaignTargeting,
  campaigns,
  creatives,
  eventAllocations,
  events,
  users,
} from '../../db/schema.js';
import { activateCampaign } from '../../lib/activation-service.js';
import { MIN_CAMPAIGN_BUDGET_TND } from '../../lib/campaign-budget.js';
import { computeCampaignCmax } from '../../lib/campaign-cmax.js';
import { plusCalendarDays } from '../../lib/campaign-dates.js';
import { getDispatchConfig } from '../../lib/dispatch/config.js';
import { computeEventCmax } from '../../lib/event-pricing/pricing.js';
import { walletSpendable } from '../../lib/recharges.js';
import { screencasterCpmRates } from '../../lib/screencaster-cpm.js';
import { createRng } from '../world/rng.js';

import { TZ, type VirtualMoment } from './clock.js';

// SIM-4 (folded into SIM-2) — « an advertiser launches a campaign ». Everything load-bearing is
// the product's own code: the ceiling comes from computeCampaignCmax, the funding gate and the
// dispatch from activateCampaign. The simulator only plays the part a human plays in the wizard:
// pick an advertiser, attach an approved creative, choose dates and a budget.
//
// The creative's storage key points at no real object. Nothing in the engines fetches it — only a
// TV would, and a simulated TV plays by writing proofs, not by downloading.

export interface LaunchInput {
  moment: VirtualMoment;
  seed: string;
  advertiserId?: string;
  name?: string;
  /** Campaign length in days (inclusive of both ends). */
  durationDays?: number;
  spotSeconds?: number;
  /** Days after the virtual day the campaign starts on; the J+2 lead is the floor. */
  startInDays?: number;
  budgetTnd?: number;
  /** Share of C_max to spend when no budget is given. */
  budgetShare?: number;
  /**
   * SIM-6 phase 3 — the targeting lines (category × class; null = « toutes »), written before the
   * ceiling is priced so C_max, the estimate and the dispatch all see them. Absent = whole network.
   */
  targeting?: { categoryId: string | null; cls: 'populaire' | 'moyen' | 'premium' | null }[];
}

export interface LaunchResult {
  campaign_id: string;
  advertiser_id: string;
  name: string;
  start_date: string;
  end_date: string;
  spot_seconds: number;
  budget_tnd: number;
  c_max_tnd: number;
  status: string;
  outcome: string;
  allocations: number;
}

export const launchCampaign = async (
  input: LaunchInput,
): Promise<LaunchResult | { error: string }> => {
  const rng = createRng(`${input.seed}:${input.moment.at.toISOString()}:launch`);
  const spotSeconds = input.spotSeconds ?? rng.pick([10, 15, 20, 30]);
  const durationDays = input.durationDays ?? rng.int(5, 14);
  const startInDays = Math.max(2, input.startInDays ?? rng.int(2, 5));

  // The advertiser: the one asked for, else the richest — a launch that cannot be funded teaches
  // nothing, and the funding gate is exercised on purpose by a budget knob, not by a random pick.
  let advertiserId = input.advertiserId;
  if (!advertiserId) {
    const candidates = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.role, 'advertiser'));
    let best: { id: string; spendable: number } | null = null;
    for (const candidate of candidates) {
      const wallet = await walletSpendable(candidate.id);
      if (!best || wallet.spendable_tnd > best.spendable) {
        best = { id: candidate.id, spendable: wallet.spendable_tnd };
      }
    }
    if (!best) return { error: 'NO_ADVERTISER' };
    advertiserId = best.id;
  }

  const startDate = plusCalendarDays(input.moment.date, startInDays);
  const endDate = plusCalendarDays(startDate, durationDays - 1);
  const name = input.name ?? `Campagne ${input.moment.date} #${rng.int(100, 999)}`;

  const [creative] = await db
    .insert(creatives)
    .values({
      advertiserId,
      creativeType: 'video',
      title: `${name} — spot ${spotSeconds}s`,
      storageKey: `sim/creatives/${rng.uuid()}.mp4`,
      durationSeconds: spotSeconds,
      validationStatus: 'approved',
      validatedAt: input.moment.at,
    })
    .returning();
  if (!creative) return { error: 'CREATIVE_FAILED' };

  const [draft] = await db
    .insert(campaigns)
    .values({
      advertiserId,
      name,
      campaignType: 'standard',
      status: 'draft',
      startDate,
      endDate,
      creativeId: creative.id,
    })
    .returning();
  if (!draft) return { error: 'CAMPAIGN_FAILED' };
  if (input.targeting && input.targeting.length > 0) {
    await db.insert(campaignTargeting).values(
      input.targeting.map((line) => ({
        campaignId: draft.id,
        categoryId: line.categoryId,
        class: line.cls,
      })),
    );
  }

  // The ceiling the wizard shows, from the real engine over the real (synthetic) inventory —
  // priced at the CPM and the T tiers the draft captured at its insert (CPM-1, CPM-2).
  const cmax = await computeCampaignCmax(
    {
      id: draft.id,
      startDate,
      endDate,
      campaignType: 'standard',
      standardCpmTnd: draft.standardCpmTnd,
      eventCpmTnd: draft.eventCpmTnd,
      t10s: draft.t10s,
      t20s: draft.t20s,
      t30s: draft.t30s,
    },
    spotSeconds,
  );
  const wallet = await walletSpendable(advertiserId);
  const wanted =
    input.budgetTnd ?? Math.floor(cmax.cMaxTnd * (input.budgetShare ?? rng.float(0.2, 0.6)));
  const budget = Math.max(
    MIN_CAMPAIGN_BUDGET_TND,
    Math.min(wanted, cmax.cMaxTnd, Math.floor(wallet.spendable_tnd)),
  );
  if (cmax.cMaxTnd < MIN_CAMPAIGN_BUDGET_TND || wallet.spendable_tnd < MIN_CAMPAIGN_BUDGET_TND) {
    await db.delete(campaigns).where(eq(campaigns.id, draft.id));
    return { error: cmax.cMaxTnd < MIN_CAMPAIGN_BUDGET_TND ? 'CMAX_TOO_LOW' : 'NOT_FUNDED' };
  }

  const [funded] = await db
    .update(campaigns)
    .set({ requestedBudget: budget.toFixed(2) })
    .where(eq(campaigns.id, draft.id))
    .returning();

  const outcome = await activateCampaign({
    campaign: funded as Campaign,
    contentValidationStatus: 'approved',
    creativeDurationSeconds: spotSeconds,
    activatedBy: null,
    fromStatus: 'draft',
  });

  // finalizeActivation decides « upcoming vs active » against the WALL clock (the one place in
  // the activation path that does not take an injected now). A simulation whose virtual day sits
  // before the real one would therefore start every campaign already active, and the
  // upcoming → active transition — a rule worth exercising — would never run. Put the campaign
  // back where the VIRTUAL clock says it belongs; the lifecycle tick then flips it for real.
  if (outcome.status === 'OK' && startDate > input.moment.date) {
    await db
      .update(campaigns)
      .set({ status: 'upcoming' })
      .where(and(eq(campaigns.id, draft.id), eq(campaigns.status, 'active')));
  }

  const [after] = await db
    .select({ status: campaigns.status })
    .from(campaigns)
    .where(eq(campaigns.id, draft.id))
    .limit(1);

  const allocations = outcome.status === 'OK' ? outcome.allocations.length : 0;

  return {
    campaign_id: draft.id,
    advertiser_id: advertiserId,
    name,
    start_date: startDate,
    end_date: endDate,
    spot_seconds: spotSeconds,
    budget_tnd: budget,
    c_max_tnd: cmax.cMaxTnd,
    status: after?.status ?? 'unknown',
    outcome: outcome.status,
    allocations,
  };
};

/** The most recent campaigns of the sandbox, for the page's board. */
export const recentCampaigns = async (limit = 20) =>
  db
    .select({
      id: campaigns.id,
      name: campaigns.name,
      status: campaigns.status,
      startDate: campaigns.startDate,
      endDate: campaigns.endDate,
      budget: campaigns.requestedBudget,
    })
    .from(campaigns)
    .orderBy(desc(campaigns.createdAt))
    .limit(limit);

// ── SIM-4 — « an advertiser books an event » ──────────────────────────────────

export interface LaunchEventInput {
  moment: VirtualMoment;
  seed: string;
  advertiserId?: string;
  name?: string;
  /** Days after the virtual day the match kicks off. */
  inDays?: number;
  /** Match length in hours (the diffusion window adds an hour on each side). */
  durationHours?: number;
  spotSeconds?: number;
  budgetTnd?: number;
  budgetShare?: number;
  /** SIM-6 phase 3 — the kickoff's Tunis clock hour (default 20h). */
  kickoffHour?: number;
}

export interface LaunchEventResult {
  event_id: string;
  campaign_id: string;
  name: string;
  kickoff_at: string;
  ends_at: string;
  budget_tnd: number;
  c_max_tnd: number;
  outcome: string;
  allocations: number;
}

export const launchEvent = async (
  input: LaunchEventInput,
): Promise<LaunchEventResult | { error: string }> => {
  const rng = createRng(`${input.seed}:${input.moment.at.toISOString()}:event`);
  const inDays = input.inDays ?? rng.int(3, 10);
  const durationHours = input.durationHours ?? 2;
  const spotSeconds = input.spotSeconds ?? rng.pick([10, 15, 20]);

  // Kickoff at 20h Tunis on the chosen day — the hour a match actually starts here.
  const kickoffDate = plusCalendarDays(input.moment.date, inDays);
  // Tunis wall-clock kickoff (default 20h — Tunis is UTC+1 all year, so the historical 19:00Z).
  const kickoffHour = input.kickoffHour ?? 20;
  const kickoffAt = fromZonedTime(
    `${kickoffDate}T${String(kickoffHour).padStart(2, '0')}:00:00`,
    TZ,
  );
  const endsAt = new Date(kickoffAt.getTime() + durationHours * 3600 * 1000);

  const [event] = await db
    .insert(events)
    .values({
      name:
        input.name ??
        `Match ${rng.pick(['Espérance', 'Club Africain', 'Étoile', 'CSS'])} — ${kickoffDate}`,
      kickoffAt,
      endsAt,
      type: 'sport',
      source: 'official',
    })
    .returning();
  if (!event) return { error: 'EVENT_FAILED' };

  let advertiserId = input.advertiserId;
  if (!advertiserId) {
    const candidates = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.role, 'advertiser'));
    let best: { id: string; spendable: number } | null = null;
    for (const candidate of candidates) {
      const wallet = await walletSpendable(candidate.id);
      if (!best || wallet.spendable_tnd > best.spendable) {
        best = { id: candidate.id, spendable: wallet.spendable_tnd };
      }
    }
    if (!best) return { error: 'NO_ADVERTISER' };
    advertiserId = best.id;
  }

  // The ceiling is read BEFORE the positioning exists (the wizard's pre-creation cursor). CPM-3 —
  // at the event CPM the positioning inserted below will capture: the screencaster's own (as GET
  // /api/events/:id/cmax prices it), the global default only for a non-advertiser account.
  const own = await screencasterCpmRates(advertiserId);
  const eventCpm = own?.eventCpmTnd ?? (await getDispatchConfig()).eventCpmTnd;
  const ceiling = await computeEventCmax({ id: event.id, kickoffAt, endsAt }, eventCpm);
  const wallet = await walletSpendable(advertiserId);
  const wanted =
    input.budgetTnd ?? Math.floor(ceiling.cMaxEvtTnd * (input.budgetShare ?? rng.float(0.3, 0.7)));
  const budget = Math.max(
    MIN_CAMPAIGN_BUDGET_TND,
    Math.min(wanted, ceiling.cMaxEvtTnd, Math.floor(wallet.spendable_tnd)),
  );
  if (
    ceiling.cMaxEvtTnd < MIN_CAMPAIGN_BUDGET_TND ||
    wallet.spendable_tnd < MIN_CAMPAIGN_BUDGET_TND
  ) {
    await db.delete(events).where(eq(events.id, event.id));
    return { error: ceiling.cMaxEvtTnd < MIN_CAMPAIGN_BUDGET_TND ? 'CMAX_TOO_LOW' : 'NOT_FUNDED' };
  }

  const [creative] = await db
    .insert(creatives)
    .values({
      advertiserId,
      creativeType: 'video',
      title: `${event.name} — spot ${spotSeconds}s`,
      storageKey: `sim/creatives/${rng.uuid()}.mp4`,
      durationSeconds: spotSeconds,
      validationStatus: 'approved',
      validatedAt: input.moment.at,
    })
    .returning();

  const [positioning] = await db
    .insert(campaigns)
    .values({
      advertiserId,
      name: `Positionnement — ${event.name}`,
      campaignType: 'event',
      status: 'draft',
      startDate: kickoffDate,
      endDate: kickoffDate,
      requestedBudget: budget.toFixed(2),
      eventId: event.id,
      creativeId: creative?.id ?? null,
    })
    .returning();
  if (!positioning) return { error: 'POSITIONING_FAILED' };

  // The activation fork: an eventId sends prepareActivation to runEventDispatch, never to the
  // standard pool — the event module's own pricing and bloc filling.
  const outcome = await activateCampaign({
    campaign: positioning,
    contentValidationStatus: 'approved',
    creativeDurationSeconds: spotSeconds,
    activatedBy: null,
    fromStatus: 'draft',
  });

  const [allocated] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(eventAllocations)
    .where(eq(eventAllocations.campaignId, positioning.id));

  if (outcome.status === 'OK' && kickoffDate > input.moment.date) {
    await db
      .update(campaigns)
      .set({ status: 'upcoming' })
      .where(and(eq(campaigns.id, positioning.id), eq(campaigns.status, 'active')));
  }

  return {
    event_id: event.id,
    campaign_id: positioning.id,
    name: event.name,
    kickoff_at: kickoffAt.toISOString(),
    ends_at: endsAt.toISOString(),
    budget_tnd: budget,
    c_max_tnd: ceiling.cMaxEvtTnd,
    outcome: outcome.status,
    allocations: allocated?.n ?? 0,
  };
};
