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
// Pricing is gated too: I_cible/CPM/S/T are admin-provided/synthetic until L-price supplies the real
// I_cible.

const idParamSchema = z.object({ id: z.uuid() });
const listQuerySchema = z.object({
  status: z.enum(['draft', 'pending', 'active', 'rejected']).optional(),
});
// Mirror the dispatch entrypoint's inputs (synthetic admin pricing for V1).
const activateBodySchema = z.object({
  i_cible: z.number().int().positive(),
  cpm: z.number().positive(),
  s: z.number().int().positive(),
  t: z.number().positive(),
});
const rejectBodySchema = z.object({ reason: z.string().trim().min(1).max(2000) });

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
  // content_validation_status (the linked creative's approval) + the advertiser's wallet balance.
  app.get('/api/admin/campaigns', adminGuard, async (request, reply) => {
    const parsedQuery = listQuerySchema.safeParse(request.query);
    if (!parsedQuery.success) {
      return invalidField(reply, 'status', 'must be draft, pending, active or rejected');
    }
    const { status } = parsedQuery.data;
    const rows = await db
      .select({ campaign: campaigns, contentValidationStatus: creatives.validationStatus })
      .from(campaigns)
      .leftJoin(creatives, eq(campaigns.creativeId, creatives.id))
      .where(status ? eq(campaigns.status, status) : undefined)
      .orderBy(desc(campaigns.createdAt));
    const out = await Promise.all(
      rows.map(async (r) => ({
        ...adminCampaignView(r.campaign, r.contentValidationStatus),
        wallet_balance_tnd: (await walletBalance(r.campaign.advertiserId)).balance_tnd,
      })),
    );
    return reply.status(200).send(out);
  });

  // POST /api/admin/campaigns/:id/activate { i_cible, cpm, s, t } — the keystone. Gate (pending +
  // approved creative + funded) then dispatch; activate only on a deliverable plan.
  app.post('/api/admin/campaigns/:id/activate', adminGuard, async (request, reply) => {
    const parsedParams = idParamSchema.safeParse(request.params);
    if (!parsedParams.success) return invalidField(reply, 'id', 'must be a uuid');
    const parsedBody = activateBodySchema.safeParse(request.body ?? {});
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
    const { i_cible: iCible, cpm, s, t } = parsedBody.data;

    const [row] = await db
      .select({ campaign: campaigns, contentValidationStatus: creatives.validationStatus })
      .from(campaigns)
      .leftJoin(creatives, eq(campaigns.creativeId, creatives.id))
      .where(eq(campaigns.id, id))
      .limit(1);
    if (!row) return reply.status(404).send({ error: 'NOT_FOUND', message: 'No such campaign.' });
    const { campaign, contentValidationStatus } = row;

    // GATE — pending → approved creative → funded (balance >= budget). NO debit (deferred to L-redisp).
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
    const budget = (iCible * cpm) / 1000; // TND; the debit seam (L-redisp bills actual impressions)
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
    const result = await runDispatch(campaign, { iCible, cpm, s, t });
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
    const [activated] = await db
      .update(campaigns)
      .set({ status: 'active', activatedAt: new Date(), activatedBy: adminId })
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
