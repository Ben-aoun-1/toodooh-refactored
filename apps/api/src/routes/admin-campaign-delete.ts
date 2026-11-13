import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { deleteStoppedCampaign } from '../lib/campaign-delete.js';
import { requireAuth, requireRole } from '../middleware/require-auth.js';

// Mariem 05/11 (ruling 1A) — DELETE /api/admin/campaigns/:id: a SUPERADMIN deletes a campaign or
// a match positioning they STOPPED first, when nothing of it aired. The rules live in
// lib/campaign-delete.ts.

const paramsSchema = z.object({ id: z.uuid() });

const REFUSALS = {
  NOT_FOUND: { code: 404, message: 'Campagne introuvable.' },
  NOT_STOPPED: {
    code: 409,
    message: 'Arrêtez d’abord la campagne : seule une campagne arrêtée peut être supprimée.',
  },
  AIRED: {
    code: 409,
    message:
      'Cette campagne a été diffusée : elle reste dans l’historique (gains des Hosts, factures).',
  },
} as const;

export const adminCampaignDeleteRoutes: FastifyPluginAsync = async (app) => {
  const superadminGuard = { preHandler: [requireAuth, requireRole('superadmin')] };

  app.delete('/api/admin/campaigns/:id', superadminGuard, async (request, reply) => {
    const params = paramsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: 'INVALID_INPUT', message: 'Identifiant invalide.' });
    }
    const outcome = await deleteStoppedCampaign(params.data.id);
    if (!outcome.ok) {
      const refusal = REFUSALS[outcome.error];
      return reply.status(refusal.code).send({ error: outcome.error, message: refusal.message });
    }
    request.log.info({ campaignId: params.data.id }, 'stopped campaign deleted by a superadmin');
    return reply.status(204).send();
  });
};
