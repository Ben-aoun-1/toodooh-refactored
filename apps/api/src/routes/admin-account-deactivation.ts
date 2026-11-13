import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { z } from 'zod';

import {
  DeactivationRefused,
  deactivateAccount,
  previewDeactivation,
  reactivateAccount,
} from '../lib/account-deactivation.js';
import { requireAdmin, requireAuth } from '../middleware/require-auth.js';

// DEACT-1 (Mariem's sheet row 11, operator rulings 2026-10-28) — admin and superadmin:
//   GET  /api/admin/users/:id/deactivation   what deactivating would touch (the confirm window);
//   POST /api/admin/users/:id/deactivate     {reason, campaigns: 'finish' | 'stop'};
//   POST /api/admin/users/:id/reactivate.
// The rules live in lib/account-deactivation.ts.

const adminGuard = { preHandler: [requireAuth, requireAdmin] };
const idParamSchema = z.object({ id: z.uuid() });
const deactivateBodySchema = z
  .object({
    reason: z.string().trim().min(3).max(500),
    campaigns: z.enum(['finish', 'stop']).default('finish'),
  })
  .strict();

const REFUSALS = {
  NOT_FOUND: { code: 404, message: 'Utilisateur introuvable.' },
  SELF: { code: 400, message: 'Vous ne pouvez pas désactiver votre propre compte.' },
  NOT_DEACTIVATABLE: {
    code: 400,
    message: 'Seuls les comptes screenhost et screencaster peuvent être désactivés.',
  },
  NOT_ACTIVE: { code: 409, message: 'Seul un compte validé peut être désactivé.' },
  NOT_DEACTIVATED: { code: 409, message: 'Ce compte n’est pas désactivé.' },
} as const;

const refuse = (reply: FastifyReply, err: DeactivationRefused) => {
  const r = REFUSALS[err.code];
  return reply.status(r.code).send({ error: err.code, message: r.message });
};

export const adminAccountDeactivationRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/admin/users/:id/deactivation', adminGuard, async (request, reply) => {
    const params = idParamSchema.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: 'INVALID_INPUT', message: 'id' });
    try {
      return reply.status(200).send(await previewDeactivation(params.data.id));
    } catch (err) {
      if (err instanceof DeactivationRefused) return refuse(reply, err);
      throw err;
    }
  });

  app.post('/api/admin/users/:id/deactivate', adminGuard, async (request, reply) => {
    const params = idParamSchema.safeParse(request.params);
    const body = deactivateBodySchema.safeParse(request.body ?? {});
    if (!params.success || !body.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Indiquez le motif de la désactivation (3 caractères minimum).',
      });
    }
    try {
      const result = await deactivateAccount({
        userId: params.data.id,
        adminId: request.user?.id ?? '',
        reason: body.data.reason,
        castCampaigns: body.data.campaigns,
        log: request.log,
      });
      return reply.status(200).send({
        status: 'deactivated',
        kind: result.kind,
        moved_campaigns: result.moved.length,
        rejected_campaigns: result.rejected,
        stopped_campaigns: result.stopped,
        finishing_campaigns: result.finishing,
      });
    } catch (err) {
      if (err instanceof DeactivationRefused) return refuse(reply, err);
      throw err;
    }
  });

  app.post('/api/admin/users/:id/reactivate', adminGuard, async (request, reply) => {
    const params = idParamSchema.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: 'INVALID_INPUT', message: 'id' });
    try {
      await reactivateAccount(params.data.id);
      return reply.status(200).send({ status: 'approved' });
    } catch (err) {
      if (err instanceof DeactivationRefused) return refuse(reply, err);
      throw err;
    }
  });
};
