import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import {
  belowInstalledMessage,
  type DeclarationScope,
  updateScreenDeclaration,
} from '../lib/screens.js';
import { requireActiveAccount, requireAdmin, requireAuth } from '../middleware/require-auth.js';
import { declaredCountSchema } from '../validation/screen-declaration.js';

// SCR-DECL1 — the per-venue « Nombre d'écrans » / « Nombre de salles » edit (operator rulings
// 2026-09-21). Q1: the owner AND admins edit it; Q4: per établissement (fleet owners have one per
// venue). The owner route is owner-scoped like PATCH /api/screenhosts/:id/hours (a foreign or
// missing id is the same 404); the admin twin reaches any venue. Both go through the ONE
// reconciliation in lib/screens.ts, so the screens rows the APK pairs against follow the count.
// PARTIAL: an omitted field is left unchanged; neither can be cleared (both are required, Q5).

const idParamSchema = z.object({ id: z.uuid() });

const declarationPatchSchema = z
  .object({ screen_count: declaredCountSchema, room_count: declaredCountSchema })
  .partial()
  .refine((b) => b.screen_count !== undefined || b.room_count !== undefined, {
    message: 'At least one field is required',
  });

const invalid = (reply: FastifyReply, fields: { field: string; reason: string }[]) =>
  reply.status(400).send({ error: 'INVALID_INPUT', message: 'Validation failed', fields });

const handleDeclarationPatch = async (
  request: FastifyRequest,
  reply: FastifyReply,
  scopeOf: (request: FastifyRequest) => DeclarationScope | null,
) => {
  const params = idParamSchema.safeParse(request.params);
  if (!params.success) return invalid(reply, [{ field: 'id', reason: 'must be a uuid' }]);
  const body = declarationPatchSchema.safeParse(request.body ?? {});
  if (!body.success) {
    return invalid(
      reply,
      body.error.issues.map((i) => ({ field: i.path.join('.') || 'body', reason: i.message })),
    );
  }
  const scope = scopeOf(request);
  if (!scope) {
    return reply
      .status(401)
      .send({ error: 'UNAUTHENTICATED', message: 'Authentication required.' });
  }
  const outcome = await updateScreenDeclaration(
    params.data.id,
    { screenCount: body.data.screen_count, roomCount: body.data.room_count },
    scope,
  );
  if (outcome.kind === 'not_found') {
    return reply.status(404).send({ error: 'NOT_FOUND', message: 'No such screenhost.' });
  }
  if (outcome.kind === 'below_installed') {
    return reply.status(409).send({
      error: 'BELOW_INSTALLED_SCREENS',
      message: belowInstalledMessage(outcome.installed),
      installed_screens_count: outcome.installed,
    });
  }
  return reply.status(200).send(outcome.view);
};

export const screenhostDeclarationRoutes: FastifyPluginAsync = async (app) => {
  // The owner app surface is status-gated like the other owner routes (N3): rejected/banned → 403.
  const ownerGuard = { preHandler: [requireAuth, requireActiveAccount] };
  const adminGuard = { preHandler: [requireAuth, requireAdmin] };

  // PATCH /api/screenhosts/:id/declaration — the owner edits one of THEIR venues.
  app.patch('/api/screenhosts/:id/declaration', ownerGuard, (request, reply) =>
    handleDeclarationPatch(request, reply, (r) => (r.user ? { ownerId: r.user.id } : null)),
  );

  // PATCH /api/admin/screenhosts/:id/declaration — an admin edits any venue.
  app.patch('/api/admin/screenhosts/:id/declaration', adminGuard, (request, reply) =>
    handleDeclarationPatch(request, reply, (r) => (r.user ? 'admin' : null)),
  );
};
