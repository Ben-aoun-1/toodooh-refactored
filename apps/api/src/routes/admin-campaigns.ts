import { and, desc, eq } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { db } from '../db/client.js';
import {
  type Campaign,
  campaignDispatchAllocation,
  campaignDispatchPlan,
  campaigns,
  creatives,
} from '../db/schema.js';
import { tunisDateOf } from '../lib/campaign-dates.js';
import { cpmForCampaign, getDispatchConfig } from '../lib/dispatch/config.js';
import { runDispatch } from '../lib/dispatch/dispatch-service.js';
import { walletBalance } from '../lib/recharges.js';
import { requireAdmin, requireAuth } from '../middleware/require-auth.js';

import { planView } from './campaign-dispatch.js';

// Admin campaign moderation (ACTIVATION WIRING — the keystone). The submit flow leaves a campaign
// status='pending'; nothing yet flips it to 'active', and L-playout GATES playout on status='active'.
// This wires the admin approval that, given an approved creative + a funded advertiser, ACTIVATES the
// campaign AND dispatches it (reusing runDispatch — the engine is never duplicated), so the whole
// chain (dispatch → playout → proof-of-play) finally runs end-to-end. Mirrors the admin recharge /
// creative review: every route is [requireAuth, requireAdmin]; a non-admin 403s, a missing campaign
// 404s; transitions are pending→x only and the UPDATE's WHERE status='pending' makes them atomic.
//
// V1 manual money model: activation gates on walletBalance >= budget but does NOT debit — the debit
// is L-redisp's at reconciliation (it bills actual aired impressions). The seam stays open here.
//
// DERIVED ACTIVATION: the engine inputs are NO LONGER admin-supplied. Approve = activate derives them
// from the campaign + config so the operator only ever clicks Approve:
//   cpm     = config CPM by type (event_cpm_tnd for an 'event' campaign, else standard_cpm_tnd)
//   i_cible = ⌊requested_budget·1000 / cpm⌋        (the advertiser's indicative ask → target impressions)
//   s       = the linked creative's duration_seconds (the spot length actually airing)
//   t       = derived INSIDE runDispatch (E1: tForDuration(s, config) — the VF attention index)
// budget (the funding gate) = requested_budget, the advertiser's stated ask.

const idParamSchema = z.object({ id: z.uuid() });
const listQuerySchema = z.object({
  status: z.enum(['draft', 'pending', 'active', 'rejected']).optional(),
});
const rejectBodySchema = z.object({ reason: z.string().trim().min(1).max(2000) });

// cpmForCampaign moved to lib/dispatch/config.ts (E5) — the C_max ceiling must price identically.

// Derived I_cible from the indicative budget at the given CPM, or null when un-derivable (no budget /
// non-positive budget). ⌊budget·1000 / cpm⌋; a sub-CPM budget floors to 0 → null (not deliverable).
const deriveICible = (requestedBudget: number | null, cpm: number): number | null => {
  if (requestedBudget === null || requestedBudget <= 0 || cpm <= 0) return null;
  const iCible = Math.floor((requestedBudget * 1000) / cpm);
  return iCible >= 1 ? iCible : null;
};

const invalidField = (reply: FastifyReply, field: string, reason: string) =>
  reply
    .status(400)
    .send({ error: 'INVALID_INPUT', message: 'Validation failed', fields: [{ field, reason }] });

// 409 for a campaign that is not pending (can't activate/reject a draft/active/rejected one). Carries
// the current status so the admin UI shows "already active/rejected" instead of a blind retry.
const sendNotPending = (
  reply: FastifyReply,
  request: FastifyRequest,
  status: string,
  verb: string,
) =>
  reply.status(409).send({
    error: 'CONFLICT',
    message: `Only a pending campaign can be ${verb} (currently ${status}).`,
    statusCode: 409,
    requestId: request.id,
    currentStatus: status,
  });

const adminCampaignView = (row: Campaign, contentValidationStatus: string | null) => ({
  id: row.id,
  advertiser_id: row.advertiserId,
  name: row.name,
  campaign_type: row.campaignType,
  status: row.status,
  start_date: row.startDate,
  end_date: row.endDate,
  description: row.description,
  requested_budget: row.requestedBudget === null ? null : Number(row.requestedBudget),
  creative_id: row.creativeId,
  content_validation_status: contentValidationStatus,
  submitted_at: row.submittedAt,
  activated_at: row.activatedAt,
  activated_by: row.activatedBy,
  rejected_at: row.rejectedAt,
  reject_reason: row.rejectReason,
  created_at: row.createdAt,
  updated_at: row.updatedAt,
});

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

export const adminCampaignsRoutes: FastifyPluginAsync = async (app) => {
  const adminGuard = { preHandler: [requireAuth, requireAdmin] };

  // GET /api/admin/campaigns[?status=] — the review queue (newest first): each campaign + its derived
  // content_validation_status (the linked creative's approval) + the advertiser's wallet balance +
  // the DERIVED pricing the operator approves (cpm_tnd by type, derived_i_cible = ⌊budget·1000/cpm⌋).
  // derived_i_cible is null when the campaign has no usable budget — the queue shows it can't activate.
  app.get('/api/admin/campaigns', adminGuard, async (request, reply) => {
    const parsedQuery = listQuerySchema.safeParse(request.query);
    if (!parsedQuery.success) {
      return invalidField(reply, 'status', 'must be draft, pending, active or rejected');
    }
    const { status } = parsedQuery.data;
    const config = await getDispatchConfig();
    const rows = await db
      .select({ campaign: campaigns, contentValidationStatus: creatives.validationStatus })
      .from(campaigns)
      .leftJoin(creatives, eq(campaigns.creativeId, creatives.id))
      .where(status ? eq(campaigns.status, status) : undefined)
      .orderBy(desc(campaigns.createdAt));
    const out = await Promise.all(
      rows.map(async (r) => {
        const cpm = cpmForCampaign(r.campaign.campaignType, config);
        const requestedBudget =
          r.campaign.requestedBudget === null ? null : Number(r.campaign.requestedBudget);
        return {
          ...adminCampaignView(r.campaign, r.contentValidationStatus),
          wallet_balance_tnd: (await walletBalance(r.campaign.advertiserId)).balance_tnd,
          cpm_tnd: cpm,
          derived_i_cible: deriveICible(requestedBudget, cpm),
        };
      }),
    );
    return reply.status(200).send(out);
  });

  // POST /api/admin/campaigns/:id/activate (NO body) — the keystone. Gate (pending + approved
  // creative) → DERIVE the engine inputs (cpm/i_cible/s/t) from the campaign + config → gate funded →
  // dispatch; activate only on a deliverable plan.
  app.post('/api/admin/campaigns/:id/activate', adminGuard, async (request, reply) => {
    const parsedParams = idParamSchema.safeParse(request.params);
    if (!parsedParams.success) return invalidField(reply, 'id', 'must be a uuid');
    const adminId = request.user?.id;
    if (!adminId) {
      return reply
        .status(401)
        .send({ error: 'UNAUTHENTICATED', message: 'Authentication required.' });
    }
    const { id } = parsedParams.data;

    const [row] = await db
      .select({
        campaign: campaigns,
        contentValidationStatus: creatives.validationStatus,
        creativeDurationSeconds: creatives.durationSeconds,
      })
      .from(campaigns)
      .leftJoin(creatives, eq(campaigns.creativeId, creatives.id))
      .where(eq(campaigns.id, id))
      .limit(1);
    if (!row) return reply.status(404).send({ error: 'NOT_FOUND', message: 'No such campaign.' });
    const { campaign, contentValidationStatus, creativeDurationSeconds } = row;

    // GATE — pending → approved creative. NO debit (deferred to L-redisp).
    if (campaign.status !== 'pending') {
      return sendNotPending(reply, request, campaign.status, 'activated');
    }
    if (contentValidationStatus !== 'approved') {
      return reply.status(422).send({
        error: 'NOT_ACTIVATABLE',
        reason: 'content_not_approved',
        message: 'The linked creative is not admin-approved (or no creative is linked).',
        content_validation_status: contentValidationStatus,
      });
    }

    // DERIVE the engine inputs (no admin-supplied pricing). cpm by type → i_cible from budget;
    // s = creative duration; t = neutral default. Each derivation that can't complete is a 422 with a
    // machine reason so the queue can tell the operator WHAT to fix (set a budget / a creative duration).
    const config = await getDispatchConfig();
    const cpm = cpmForCampaign(campaign.campaignType, config);
    const requestedBudget =
      campaign.requestedBudget === null ? null : Number(campaign.requestedBudget);
    if (requestedBudget === null || requestedBudget <= 0) {
      return reply.status(422).send({
        error: 'NOT_ACTIVATABLE',
        reason: 'no_budget',
        message: 'The campaign has no indicative budget to derive a target from.',
        requested_budget: requestedBudget,
      });
    }
    if (creativeDurationSeconds === null || creativeDurationSeconds <= 0) {
      return reply.status(422).send({
        error: 'NOT_ACTIVATABLE',
        reason: 'no_duration',
        message: 'The linked creative has no diffusion duration to use as the spot length.',
        duration_seconds: creativeDurationSeconds,
      });
    }
    const iCible = deriveICible(requestedBudget, cpm);
    if (iCible === null) {
      return reply.status(422).send({
        error: 'NOT_ACTIVATABLE',
        reason: 'budget_too_low',
        message: 'The indicative budget is below one CPM unit — no impressions can be targeted.',
        requested_budget: requestedBudget,
        cpm_tnd: cpm,
      });
    }
    const s = creativeDurationSeconds;
    // E1 (VF) — T is duration-derived inside runDispatch (tForDuration), no longer passed here.

    // Funded gate: balance >= the advertiser's indicative budget (the ask). NO debit (L-redisp bills
    // actual aired impressions at reconciliation).
    const budget = requestedBudget;
    const balance = (await walletBalance(campaign.advertiserId)).balance_tnd;
    if (balance < budget) {
      return reply.status(422).send({
        error: 'NOT_ACTIVATABLE',
        reason: 'insufficient_balance',
        message: 'The advertiser wallet balance is below the campaign budget.',
        required_tnd: budget,
        available_tnd: balance,
      });
    }

    // Dispatch (reuse the engine). Every DispatchResult case is handled.
    const result = await runDispatch(campaign, { iCible, cpm, s });
    if (result.status === 'NO_WINDOW') {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        fields: [{ field: 'window', reason: 'campaign requires a start_date and end_date' }],
      });
    }
    if (result.status === 'NO_TARGETING') {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        fields: [{ field: 'targeting', reason: 'campaign requires at least one targeting line' }],
      });
    }
    // Clôture — NOT a deliverable plan → do NOT activate; the campaign stays pending (renvoi curseur).
    if (result.status === 'TOO_THIN') {
      return reply.status(422).send({
        error: 'NOT_DELIVERABLE',
        reason: 'too_thin',
        message:
          'Covering I_cible would exceed materiality (N_min > N_max). Lower the cursor or broaden targeting, then retry.',
        n_min: result.nMin,
        n_max: result.nMax,
      });
    }
    if (result.status === 'NO_ELIGIBLE') {
      return reply.status(422).send({
        error: 'NOT_DELIVERABLE',
        reason: 'no_eligible',
        message: 'No eligible screenhost could be allocated. Adjust targeting/window, then retry.',
      });
    }

    // OK (just frozen) or ALREADY_DISPATCHED (a prior /dispatch froze it) → activate.
    const loaded = await loadPlan(campaign.id);
    if (!loaded) {
      return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Dispatch plan missing.' });
    }
    // CF-S1 — approval routes by date (Tunis calendar): a future start is 'upcoming' (the
    // lifecycle job flips it to 'active' on day one); today-or-past goes straight to 'active'.
    // Dispatch already ran above either way (the plan freezes at approval, unchanged).
    const approvedStatus =
      campaign.startDate && campaign.startDate > tunisDateOf(new Date()) ? 'upcoming' : 'active';
    const [activated] = await db
      .update(campaigns)
      .set({ status: approvedStatus, activatedAt: new Date(), activatedBy: adminId })
      // Atomic transition: a concurrent activate can't double-flip (lost race → 0 rows → 409).
      .where(and(eq(campaigns.id, id), eq(campaigns.status, 'pending')))
      .returning();
    if (!activated) {
      const [current] = await db
        .select({ status: campaigns.status })
        .from(campaigns)
        .where(eq(campaigns.id, id))
        .limit(1);
      return sendNotPending(reply, request, current?.status ?? campaign.status, 'activated');
    }
    return reply.status(200).send({
      campaign: adminCampaignView(activated, contentValidationStatus),
      ...planView(loaded.plan, loaded.allocations),
    });
  });

  // POST /api/admin/campaigns/:id/reject { reason } — pending → rejected; a reason is REQUIRED and is
  // surfaced to the advertiser (reject_reason). Does NOT dispatch.
  app.post('/api/admin/campaigns/:id/reject', adminGuard, async (request, reply) => {
    const parsedParams = idParamSchema.safeParse(request.params);
    if (!parsedParams.success) return invalidField(reply, 'id', 'must be a uuid');
    const parsedBody = rejectBodySchema.safeParse(request.body ?? {});
    if (!parsedBody.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        fields: parsedBody.error.issues.map((i) => ({
          field: i.path.join('.'),
          reason: i.message,
        })),
      });
    }
    const adminId = request.user?.id;
    if (!adminId) {
      return reply
        .status(401)
        .send({ error: 'UNAUTHENTICATED', message: 'Authentication required.' });
    }
    const { id } = parsedParams.data;
    const [existing] = await db
      .select({ status: campaigns.status })
      .from(campaigns)
      .where(eq(campaigns.id, id))
      .limit(1);
    if (!existing)
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'No such campaign.' });
    if (existing.status !== 'pending')
      return sendNotPending(reply, request, existing.status, 'rejected');

    const [updated] = await db
      .update(campaigns)
      .set({ status: 'rejected', rejectedAt: new Date(), rejectReason: parsedBody.data.reason })
      .where(and(eq(campaigns.id, id), eq(campaigns.status, 'pending')))
      .returning();
    if (!updated) {
      const [current] = await db
        .select({ status: campaigns.status })
        .from(campaigns)
        .where(eq(campaigns.id, id))
        .limit(1);
      return sendNotPending(reply, request, current?.status ?? existing.status, 'rejected');
    }
    return reply.status(200).send(adminCampaignView(updated, null));
  });
};
