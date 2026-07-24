import { formatInTimeZone } from 'date-fns-tz';
import { eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { db } from '../db/client.js';
import {
  type CampaignReconciliation,
  type CampaignScreenhostPayout,
  campaigns,
  reversementLines,
  screenhosts,
} from '../db/schema.js';
import { reconcileCampaignById } from '../lib/reconcile/reconcile-service.js';
import { requireAdmin, requireAuth } from '../middleware/require-auth.js';

// Reconciliation trigger (L-redisp §B.4). An admin reconciles an ACTIVE campaign PAST its end-date:
// value what the frozen plan promised vs what proof_of_play shows aired, settle the screencaster
// wallet (the spend), and record each screenhost's earnings. Idempotent — an already-reconciled
// campaign 409s (the unique(campaign_id) row is the guard). Auto-scheduling at clôture (cron) is
// DEFERRED; this is the manual/internal trigger. The campaign status is left 'active' (no terminal
// enum value yet); the L-playout window gate already stops a past-end-date campaign from airing.

const idParamSchema = z.object({ id: z.uuid() });
const TZ = 'Africa/Tunis';

const reconciliationView = (r: CampaignReconciliation, payouts: CampaignScreenhostPayout[]) => ({
  campaign_id: r.campaignId,
  expected_imp: r.expectedImp,
  delivered_imp: r.deliveredImp,
  manquement_imp: r.manquementImp,
  p_perte_tnd: Number(r.pPerteTnd),
  refund_tnd: Number(r.refundTnd),
  spend_tnd: Number(r.spendTnd),
  status: r.status,
  reconciled_at: r.reconciledAt,
  screenhosts: payouts.map((p) => ({
    screenhost_id: p.screenhostId,
    expected_imp: p.expectedImp,
    delivered_imp: p.deliveredImp,
    earnings_tnd: Number(p.earningsTnd),
  })),
});

export const adminReconcileRoutes: FastifyPluginAsync = async (app) => {
  const adminGuard = { preHandler: [requireAuth, requireAdmin] };

  app.post('/api/admin/campaigns/:id/reconcile', adminGuard, async (request, reply) => {
    const parsedParams = idParamSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        fields: [{ field: 'id', reason: 'must be a uuid' }],
      });
    }
    const adminId = request.user?.id;
    if (!adminId) {
      return reply
        .status(401)
        .send({ error: 'UNAUTHENTICATED', message: 'Authentication required.' });
    }
    const { id } = parsedParams.data;

    const [campaign] = await db
      .select({ id: campaigns.id, status: campaigns.status, endDate: campaigns.endDate })
      .from(campaigns)
      .where(eq(campaigns.id, id))
      .limit(1);
    if (!campaign) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'No such campaign.' });
    }
    // Reconcile only an ACTIVE campaign that is PAST its end-date (Africa/Tunis), so all airing is in.
    if (campaign.status !== 'active') {
      return reply.status(409).send({
        error: 'CONFLICT',
        message: `Only an active campaign can be reconciled (currently ${campaign.status}).`,
        statusCode: 409,
        currentStatus: campaign.status,
      });
    }
    const today = formatInTimeZone(new Date(), TZ, 'yyyy-MM-dd');
    if (!campaign.endDate || campaign.endDate >= today) {
      return reply.status(409).send({
        error: 'CONFLICT',
        message: 'Campaign has not ended yet — reconcile after its end_date.',
        statusCode: 409,
      });
    }

    const result = await reconcileCampaignById(id, adminId);
    if (result.status === 'NO_PLAN') {
      return reply.status(409).send({
        error: 'CONFLICT',
        message: 'Campaign has no frozen dispatch plan.',
        statusCode: 409,
      });
    }
    if (result.status === 'ALREADY_RECONCILED') {
      return reply
        .status(409)
        .send({ error: 'CONFLICT', message: 'Campaign already reconciled.', statusCode: 409 });
    }
    return reply.status(201).send(reconciliationView(result.reconciliation, result.payouts));
  });

  // GET /api/admin/campaigns/:id/reversements — E7: the settlement's per-SH 50/44/3/3 breakdown +
  // totals. An existing-but-unsettled campaign returns empty lines + zero totals (the FE renders
  // its own "not settled" state); an unknown campaign 404s. Amounts are numeric strings in the DB
  // — summed at 4-dp precision (the columns' scale), same rounding as the money views.
  const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

  app.get('/api/admin/campaigns/:id/reversements', adminGuard, async (request, reply) => {
    const parsedParams = idParamSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        fields: [{ field: 'id', reason: 'must be a uuid' }],
      });
    }
    const { id } = parsedParams.data;
    const [campaign] = await db
      .select({ id: campaigns.id })
      .from(campaigns)
      .where(eq(campaigns.id, id))
      .limit(1);
    if (!campaign) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'No such campaign.' });
    }

    const rows = await db
      .select({
        screenhostId: reversementLines.screenhostId,
        screenhostName: screenhosts.name,
        source: reversementLines.source,
        baseValueTnd: reversementLines.baseValueTnd,
        shAmountTnd: reversementLines.shAmountTnd,
        toodoohAmountTnd: reversementLines.toodoohAmountTnd,
        agentShAmountTnd: reversementLines.agentShAmountTnd,
        agentScAmountTnd: reversementLines.agentScAmountTnd,
        agentShId: reversementLines.agentShId,
        agentScId: reversementLines.agentScId,
        settledAt: reversementLines.settledAt,
      })
      .from(reversementLines)
      .innerJoin(screenhosts, eq(screenhosts.id, reversementLines.screenhostId))
      .where(eq(reversementLines.campaignId, id));

    const sum = (pick: (r: (typeof rows)[number]) => string): number =>
      round4(rows.reduce((s, r) => s + Number(pick(r)), 0));

    return reply.status(200).send({
      campaign_id: id,
      lines: rows.map((r) => ({
        screenhost_id: r.screenhostId,
        screenhost_name: r.screenhostName,
        source: r.source,
        base_value_tnd: Number(r.baseValueTnd),
        sh_amount_tnd: Number(r.shAmountTnd),
        toodooh_amount_tnd: Number(r.toodoohAmountTnd),
        agent_sh_amount_tnd: Number(r.agentShAmountTnd),
        agent_sc_amount_tnd: Number(r.agentScAmountTnd),
        agent_sh_id: r.agentShId,
        agent_sc_id: r.agentScId,
        settled_at: r.settledAt,
      })),
      totals: {
        base_value_tnd: sum((r) => r.baseValueTnd),
        sh_amount_tnd: sum((r) => r.shAmountTnd),
        toodooh_amount_tnd: sum((r) => r.toodoohAmountTnd),
        agent_sh_amount_tnd: sum((r) => r.agentShAmountTnd),
        agent_sc_amount_tnd: sum((r) => r.agentScAmountTnd),
      },
    });
  });
};
