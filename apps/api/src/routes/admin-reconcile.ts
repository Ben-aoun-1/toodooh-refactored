import { formatInTimeZone } from 'date-fns-tz';
import { eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { db } from '../db/client.js';
import {
  type CampaignReconciliation,
  type CampaignScreenhostPayout,
  campaigns,
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
};
