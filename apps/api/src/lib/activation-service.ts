import { and, eq } from 'drizzle-orm';

import { db } from '../db/client.js';
import {
  type Campaign,
  campaignDispatchAllocation,
  campaignDispatchPlan,
  campaigns,
} from '../db/schema.js';

import { tunisDateOf } from './campaign-dates.js';
import { cpmForCampaign, getDispatchConfig } from './dispatch/config.js';
import { runDispatch } from './dispatch/dispatch-service.js';
import { createEngineTrace } from './engine-journal/trace.js';
import { walletBalance } from './recharges.js';

// CF-SK1 — THE ACTIVATION CORE, extracted VERBATIM from the admin activate route
// (routes/admin-campaigns.ts) so admin activation and the cart's approved-spot skip run the
// SAME gate chain, the SAME dispatch call and the SAME date-routed flip. The route keeps only
// its HTTP shell (param parse, auth, row load, 404) and maps these outcomes back to the exact
// bodies it always returned — behavior byte-unchanged (its suite pins it).
//
// ORDERING NOTE (pre-existing, preserved): runDispatch freezes the plan in ITS OWN transaction
// (advisory locks inside), then the status flip is a separate atomic UPDATE. The admin route has
// always worked this way; the core inherits it rather than inventing new transaction semantics.
// Dispatch/selection/reconcile are CONSUMED, never modified.

/** The status a campaign is activated FROM: 'pending' for admin review, 'draft' for the cart skip. */
export type ActivationFromStatus = 'pending' | 'draft';

export type ActivationOutcome =
  | {
      status: 'OK';
      campaign: Campaign;
      plan: typeof campaignDispatchPlan.$inferSelect;
      allocations: (typeof campaignDispatchAllocation.$inferSelect)[];
    }
  | {
      status: 'NOT_ACTIVATABLE';
      reason: 'content_not_approved';
      contentValidationStatus: string | null;
    }
  | { status: 'NOT_ACTIVATABLE'; reason: 'no_budget'; requestedBudget: number | null }
  | { status: 'NOT_ACTIVATABLE'; reason: 'no_duration'; durationSeconds: number | null }
  | { status: 'NOT_ACTIVATABLE'; reason: 'budget_too_low'; requestedBudget: number; cpmTnd: number }
  | {
      status: 'NOT_ACTIVATABLE';
      reason: 'insufficient_balance';
      requiredTnd: number;
      availableTnd: number;
    }
  | { status: 'NOT_DELIVERABLE'; reason: 'too_thin'; nMin: number; nMax: number }
  | { status: 'NOT_DELIVERABLE'; reason: 'no_eligible' }
  | { status: 'NO_WINDOW' }
  | { status: 'WRONG_STATUS'; currentStatus: string }
  | { status: 'PLAN_MISSING' };

export interface ActivationInput {
  campaign: Campaign;
  contentValidationStatus: string | null;
  creativeDurationSeconds: number | null;
  /** The moderating admin, or NULL when the system activates (the CF-SK1 approved-spot skip). */
  activatedBy: string | null;
  /** Which status the atomic flip transitions FROM (guards the concurrent-flip race). */
  fromStatus: ActivationFromStatus;
}

// Derived I_cible from the indicative budget at the given CPM, or null when un-derivable.
// ⌊budget·1000 / cpm⌋; a sub-CPM budget floors to 0 → null (not deliverable).
const deriveICible = (requestedBudget: number | null, cpm: number): number | null => {
  if (requestedBudget === null || requestedBudget <= 0 || cpm <= 0) return null;
  const iCible = Math.floor((requestedBudget * 1000) / cpm);
  return iCible >= 1 ? iCible : null;
};

// Load the frozen plan + its allocations for a campaign (for the activation summary).
const loadPlan = async (campaignId: string) => {
  const [plan] = await db
    .select()
    .from(campaignDispatchPlan)
    .where(eq(campaignDispatchPlan.campaignId, campaignId))
    .limit(1);
  if (!plan) return null;
  const allocations = await db
    .select()
    .from(campaignDispatchAllocation)
    .where(eq(campaignDispatchAllocation.planId, plan.id));
  return { plan, allocations };
};

/** The prepare phase's outcome: READY carries the frozen (or resumed) plan; the rest refuse. */
export type PreparedActivation =
  | {
      status: 'READY';
      plan: typeof campaignDispatchPlan.$inferSelect;
      allocations: (typeof campaignDispatchAllocation.$inferSelect)[];
    }
  | Exclude<ActivationOutcome, { status: 'OK' }>;

// db or the caller's open transaction — the cart finalizes every flip inside its ONE confirm tx.
type DbExecutor = typeof db | Parameters<Parameters<(typeof db)['transaction']>[0]>[0];

/**
 * PREPARE: gate → derive → fund-check → dispatch → load the frozen plan. NO status flip — that
 * is finalize's. RESUME semantics (CF-SK1 amendment, ratified): when the campaign already
 * carries a frozen plan, runDispatch returns ALREADY_DISPATCHED *before doing anything* — no
 * re-pool, no re-notification (owner EN_ATTENTE rows were inserted inside the one-shot freeze
 * transaction) — and prepare proceeds to load that plan. So activation is IDEMPOTENT up to the
 * flip: a cart skip item stranded as draft-with-frozen-plan by a later item's failure simply
 * resumes on retry. This is not new behavior — it is the admin route's pre-existing semantics
 * (POST /:id/dispatch then activate has always resumed this way); both paths share it.
 */
export const prepareActivation = async (
  input: Omit<ActivationInput, 'activatedBy'>,
): Promise<PreparedActivation> => {
  const { campaign, contentValidationStatus, creativeDurationSeconds, fromStatus } = input;

  if (campaign.status !== fromStatus) {
    return { status: 'WRONG_STATUS', currentStatus: campaign.status };
  }
  if (contentValidationStatus !== 'approved') {
    return { status: 'NOT_ACTIVATABLE', reason: 'content_not_approved', contentValidationStatus };
  }

  const config = await getDispatchConfig();
  const cpm = cpmForCampaign(campaign.campaignType, config);
  const requestedBudget =
    campaign.requestedBudget === null ? null : Number(campaign.requestedBudget);
  if (requestedBudget === null || requestedBudget <= 0) {
    return { status: 'NOT_ACTIVATABLE', reason: 'no_budget', requestedBudget };
  }
  if (creativeDurationSeconds === null || creativeDurationSeconds <= 0) {
    return {
      status: 'NOT_ACTIVATABLE',
      reason: 'no_duration',
      durationSeconds: creativeDurationSeconds,
    };
  }
  const iCible = deriveICible(requestedBudget, cpm);
  if (iCible === null) {
    return { status: 'NOT_ACTIVATABLE', reason: 'budget_too_low', requestedBudget, cpmTnd: cpm };
  }
  const s = creativeDurationSeconds;

  // Funded gate: balance ≥ the advertiser's indicative budget (the ask). NO debit (L-redisp bills
  // actual aired impressions at reconciliation). The cart's confirm checks the SAME derived
  // balance for the whole basket first; running it here too keeps ONE gate chain with no
  // divergence between the two entry points.
  const balance = (await walletBalance(campaign.advertiserId)).balance_tnd;
  if (balance < requestedBudget) {
    return {
      status: 'NOT_ACTIVATABLE',
      reason: 'insufficient_balance',
      requiredTnd: requestedBudget,
      availableTnd: balance,
    };
  }

  // Dispatch (reuse the engine). Every DispatchResult case is handled. LOG1 — the production
  // entry constructs the journal collector; runDispatch buffers and flushes it POST-outcome
  // (committed OR rolled-back clôture), so the operator can see WHY an activation refused.
  const result = await runDispatch(
    campaign,
    { iCible, cpm, s },
    createEngineTrace('dispatch', campaign.id),
  );
  if (result.status === 'NO_WINDOW') return { status: 'NO_WINDOW' };
  // Clôture — NOT a deliverable plan → do NOT activate; the campaign keeps its status.
  if (result.status === 'TOO_THIN') {
    return { status: 'NOT_DELIVERABLE', reason: 'too_thin', nMin: result.nMin, nMax: result.nMax };
  }
  if (result.status === 'NO_ELIGIBLE') return { status: 'NOT_DELIVERABLE', reason: 'no_eligible' };

  // OK (just frozen) or ALREADY_DISPATCHED (a prior freeze — resumed) → the plan is ready.
  const loaded = await loadPlan(campaign.id);
  if (!loaded) return { status: 'PLAN_MISSING' };
  return { status: 'READY', plan: loaded.plan, allocations: loaded.allocations };
};

/**
 * FINALIZE: the date-routed atomic flip, on the caller's executor (db, or the cart's confirm
 * transaction). The date routing (CF-S1): a future start becomes 'upcoming' (the lifecycle job
 * flips it to 'active' on day one); today-or-past goes straight to 'active'. NO money moves —
 * the funded gate was a READ in prepare; the settlement debit stays at reconciliation.
 */
export const finalizeActivation = async (
  executor: DbExecutor,
  campaign: Campaign,
  { activatedBy, fromStatus }: { activatedBy: string | null; fromStatus: ActivationFromStatus },
): Promise<{ activated: Campaign } | { status: 'WRONG_STATUS'; currentStatus: string }> => {
  const approvedStatus =
    campaign.startDate && campaign.startDate > tunisDateOf(new Date()) ? 'upcoming' : 'active';
  const [activated] = await executor
    .update(campaigns)
    .set({ status: approvedStatus, activatedAt: new Date(), activatedBy })
    // Atomic transition: a concurrent activate can't double-flip (lost race → 0 rows → conflict).
    .where(and(eq(campaigns.id, campaign.id), eq(campaigns.status, fromStatus)))
    .returning();
  if (!activated) {
    const [current] = await executor
      .select({ status: campaigns.status })
      .from(campaigns)
      .where(eq(campaigns.id, campaign.id))
      .limit(1);
    return { status: 'WRONG_STATUS', currentStatus: current?.status ?? campaign.status };
  }
  return { activated };
};

/**
 * Gate → derive → fund-check → dispatch → date-routed atomic flip. The ONE activation path —
 * prepare + finalize in sequence (the admin route consumes this whole; the cart splits the two
 * phases so ALL its flips land inside the single confirm transaction).
 */
export const activateCampaign = async (input: ActivationInput): Promise<ActivationOutcome> => {
  const prepared = await prepareActivation(input);
  if (prepared.status !== 'READY') return prepared;
  const flipped = await finalizeActivation(db, input.campaign, {
    activatedBy: input.activatedBy,
    fromStatus: input.fromStatus,
  });
  if ('currentStatus' in flipped) {
    return { status: 'WRONG_STATUS', currentStatus: flipped.currentStatus };
  }
  return {
    status: 'OK',
    campaign: flipped.activated,
    plan: prepared.plan,
    allocations: prepared.allocations,
  };
};
