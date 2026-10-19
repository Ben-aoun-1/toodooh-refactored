import { eq } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { z } from 'zod';

import { db } from '../db/client.js';
import { users } from '../db/schema.js';
import {
  AccountDeletionRefused,
  deleteAccountCompletely,
  previewAccountDeletion,
} from '../lib/account-deletion/execute.js';
import { requireAuth, requireRole } from '../middleware/require-auth.js';

// DEL-1 (operator 2026-10-19, rulings A A B A) — complete account deletion, superadmin only:
//   GET    /api/admin/users/:id/deletion  what would go (row counts per table) — the confirm dialog;
//   POST   /api/admin/users/:id/delete    {reason, confirm_email} → deleted here and in the hub.
// The email must be retyped exactly: a deletion cannot be undone (only the financial archive stays).

const superadminGuard = { preHandler: [requireAuth, requireRole('superadmin')] };
const idParamSchema = z.object({ id: z.uuid() });
const bodySchema = z.object({
  reason: z.string().trim().min(3).max(500),
  confirm_email: z.string().trim().min(3).max(320),
});

const refusal = (reply: FastifyReply, err: AccountDeletionRefused) => {
  if (err.code === 'NOT_FOUND') {
    return reply.status(404).send({ error: 'NOT_FOUND', message: 'Utilisateur introuvable.' });
  }
  if (err.code === 'SELF') {
    return reply.status(400).send({
      error: 'CANNOT_DELETE_SELF',
      message: 'Vous ne pouvez pas supprimer votre propre compte.',
    });
  }
  return reply.status(400).send({
    error: 'NOT_DELETABLE',
    message: 'Seuls les comptes screencaster, screenhost et agent peuvent être supprimés ici.',
  });
};

export const adminAccountDeletionRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/admin/users/:id/deletion', superadminGuard, async (request, reply) => {
    const params = idParamSchema.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: 'INVALID_INPUT', message: 'id' });
    try {
      return reply.status(200).send(await previewAccountDeletion(params.data.id));
    } catch (err) {
      if (err instanceof AccountDeletionRefused) return refusal(reply, err);
      throw err;
    }
  });

  app.post('/api/admin/users/:id/delete', superadminGuard, async (request, reply) => {
    const params = idParamSchema.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: 'INVALID_INPUT', message: 'id' });
    const body = bodySchema.safeParse(request.body ?? {});
    if (!body.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Indiquez un motif (3 caractères minimum) et l’e-mail du compte.',
      });
    }
    const adminId = request.user?.id ?? '';
    const [target] = await db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, params.data.id))
      .limit(1);
    if (!target)
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'Utilisateur introuvable.' });
    if (target.email.toLowerCase() !== body.data.confirm_email.toLowerCase()) {
      return reply.status(400).send({
        error: 'CONFIRM_EMAIL_MISMATCH',
        message: 'L’e-mail saisi ne correspond pas au compte.',
      });
    }
    try {
      const result = await deleteAccountCompletely({
        userId: params.data.id,
        adminId,
        reason: body.data.reason,
        log: request.log,
      });
      return reply.status(200).send({
        deleted: params.data.id,
        deletion_id: result.deletionId,
        counts: result.counts,
        archived_files: result.archivedFiles,
      });
    } catch (err) {
      if (err instanceof AccountDeletionRefused) return refusal(reply, err);
      throw err;
    }
  });
};
