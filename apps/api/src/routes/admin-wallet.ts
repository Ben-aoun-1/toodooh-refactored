import { desc, eq } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { z } from 'zod';

import { db } from '../db/client.js';
import { notifications, users, walletAdjustments } from '../db/schema.js';
import { MAX_RECHARGE_TND } from '../lib/recharges.js';
import {
  adjustmentNotification,
  adminAdjustmentView,
  isValidAdjustmentAmount,
} from '../lib/wallet-adjustments.js';
import { requireAdmin, requireAuth } from '../middleware/require-auth.js';

// FCT2 (US-FCT-9) — the admin wallet adjustment: a SIGNED correction of a screencaster's derived
// balance, ALWAYS audited (admin id + reason NOT NULL — no reason, no adjustment) and ALWAYS
// notified to the screencaster in French. The row is the audit — immutable, no update/delete
// route. The balance effect rides lib/recharges.ts walletBalance's third SUM term; the funded
// gates' read-only posture is untouched.

const idParamSchema = z.object({ id: z.uuid() });
const adjustmentBodySchema = z.object({
  amount_tnd: z.number(),
  reason: z.string().trim().min(1).max(2000),
});

const invalidField = (reply: FastifyReply, field: string, reason: string) =>
  reply
    .status(400)
    .send({ error: 'INVALID_INPUT', message: 'Validation failed', fields: [{ field, reason }] });

export const adminWalletRoutes: FastifyPluginAsync = async (app) => {
  const adminGuard = { preHandler: [requireAuth, requireAdmin] };

  // POST /api/admin/advertisers/:id/wallet-adjustment {amount_tnd, reason} — 201 the audit row.
  // A missing user and a non-advertiser target are INDISTINGUISHABLE (one 404): adjustments only
  // exist for screencasters.
  app.post('/api/admin/advertisers/:id/wallet-adjustment', adminGuard, async (request, reply) => {
    const parsedParams = idParamSchema.safeParse(request.params);
    if (!parsedParams.success) return invalidField(reply, 'id', 'must be a uuid');
    const parsedBody = adjustmentBodySchema.safeParse(request.body ?? {});
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
    const { amount_tnd: amount, reason } = parsedBody.data;
    if (!isValidAdjustmentAmount(amount)) {
      return invalidField(
        reply,
        'amount_tnd',
        `amount must be non-zero, have at most 2 decimals, and be within ±${MAX_RECHARGE_TND}`,
      );
    }
    const adminId = request.user?.id;
    if (!adminId) {
      return reply
        .status(401)
        .send({ error: 'UNAUTHENTICATED', message: 'Authentication required.' });
    }

    const [target] = await db
      .select({ id: users.id, role: users.role })
      .from(users)
      .where(eq(users.id, parsedParams.data.id))
      .limit(1);
    if (!target || target.role !== 'advertiser') {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'No such advertiser.' });
    }

    // The audit row and its French notification land (or fail) together.
    const row = await db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(walletAdjustments)
        .values({
          advertiserId: target.id,
          adminId,
          amountTnd: amount.toFixed(2),
          reason,
        })
        .returning();
      if (!inserted) return undefined;
      await tx.insert(notifications).values(adjustmentNotification(inserted, amount));
      return inserted;
    });
    if (!row) {
      return reply
        .status(500)
        .send({ error: 'INTERNAL_ERROR', message: 'Adjustment write failed.' });
    }
    return reply.status(201).send(adminAdjustmentView(row));
  });

  // GET /api/admin/advertisers/:id/wallet-adjustments — the audit trail, newest first.
  app.get('/api/admin/advertisers/:id/wallet-adjustments', adminGuard, async (request, reply) => {
    const parsed = idParamSchema.safeParse(request.params);
    if (!parsed.success) return invalidField(reply, 'id', 'must be a uuid');
    const rows = await db
      .select()
      .from(walletAdjustments)
      .where(eq(walletAdjustments.advertiserId, parsed.data.id))
      .orderBy(desc(walletAdjustments.createdAt));
    return reply.status(200).send(rows.map(adminAdjustmentView));
  });
};
