import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { STOP_REASON_MAX, STOP_REASON_MIN, stopCampaign } from '../lib/campaign-stop.js';
import { requireAuth, requireRole } from '../middleware/require-auth.js';

// STOP-1 (operator rulings 2026-10-27) — POST /api/admin/campaigns/:id/stop {reason}: a
// SUPERADMIN ends a standard campaign — or, since Mariem 05/11, a match positioning — now (it
// moves money: refund + venue earnings). The rules live in lib/campaign-stop.ts.

const paramsSchema = z.object({ id: z.uuid() });
const bodySchema = z
  .object({ reason: z.string().trim().min(STOP_REASON_MIN).max(STOP_REASON_MAX) })
  .strict();

const REFUSALS = {
  NOT_FOUND: { code: 404, message: 'Campagne introuvable.' },
  NOT_STOPPABLE: {
    code: 409,
    message: 'Seule une campagne en cours ou à venir peut être arrêtée.',
  },
  NO_PLAN: { code: 409, message: 'Cette campagne n’a pas de plan de diffusion à solder.' },
} as const;

export const adminCampaignStopRoutes: FastifyPluginAsync = async (app) => {
  const superadminGuard = { preHandler: [requireAuth, requireRole('superadmin')] };

  app.post('/api/admin/campaigns/:id/stop', superadminGuard, async (request, reply) => {
    const params = paramsSchema.safeParse(request.params);
    const body = bodySchema.safeParse(request.body);
    if (!params.success || !body.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: `Indiquez le motif de l’arrêt (${STOP_REASON_MIN} à ${STOP_REASON_MAX} caractères).`,
      });
    }
    const adminId = request.user?.id;
    if (!adminId) {
      return reply
        .status(401)
        .send({ error: 'UNAUTHENTICATED', message: 'Authentification requise.' });
    }
    const outcome = await stopCampaign({
      campaignId: params.data.id,
      adminId,
      reason: body.data.reason,
      log: request.log,
    });
    if (!outcome.ok) {
      const refusal = REFUSALS[outcome.error];
      return reply.status(refusal.code).send({ error: outcome.error, message: refusal.message });
    }
    return reply.status(200).send({
      status: 'completed',
      refund_tnd: outcome.refundTnd,
      spend_tnd: outcome.spendTnd,
    });
  });
};
