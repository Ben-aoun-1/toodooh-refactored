import { eq } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { z } from 'zod';

import { db } from '../db/client.js';
import { users } from '../db/schema.js';
import { accountActivity, hasActivity } from '../lib/account-deletion/activity.js';
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
//
// DEL-2 (Mariem's sheet row 12, ruling 2026-10-28 « both, superadmin choice ») — ADMINS may delete
// only an account with NO activity (lib/account-deletion/activity.ts); otherwise 409
// HAS_ACTIVITY and the admin is pointed at deactivation. A SUPERADMIN may still delete any
// account completely. The preview carries the activity so the dialog can say which case it is.

const adminGuard = { preHandler: [requireAuth, requireRole('admin', 'superadmin')] };
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
  app.get('/api/admin/users/:id/deletion', adminGuard, async (request, reply) => {
    const params = idParamSchema.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: 'INVALID_INPUT', message: 'id' });
    try {
      const preview = await previewAccountDeletion(params.data.id);
      const activity = await accountActivity(params.data.id);
      return reply.status(200).send({
        ...preview,
        activity,
        has_activity: hasActivity(activity),
        // What THIS caller may do: an admin cannot delete an account with activity.
        can_delete: request.user?.role === 'superadmin' || !hasActivity(activity),
      });
    } catch (err) {
      if (err instanceof AccountDeletionRefused) return refusal(reply, err);
      throw err;
    }
  });

  app.post('/api/admin/users/:id/delete', adminGuard, async (request, reply) => {
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
    if (request.user?.role !== 'superadmin' && hasActivity(await accountActivity(params.data.id))) {
      return reply.status(409).send({
        error: 'HAS_ACTIVITY',
        message:
          'Ce compte a déjà eu une activité (campagnes, diffusions, reversements ou factures) : il ne peut pas être supprimé. Désactivez-le plutôt.',
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
