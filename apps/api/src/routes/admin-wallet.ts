import { desc, eq } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { z } from 'zod';

import { db } from '../db/client.js';
import { type Recharge, notifications, recharges, users, walletAdjustments } from '../db/schema.js';
import {
  ADMIN_PAYMENT_MODES,
  adminPaymentNotification,
  adminPaymentReference,
  isValidAdminPaymentAmount,
} from '../lib/admin-payment.js';
import { noticeAffiliateRecharged } from '../lib/agent-commissions.js';
import { isUniqueViolation, walletSpendable } from '../lib/recharges.js';
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
        'amount must be non-zero and have at most 2 decimals',
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

  // ADM-CREDIT1 — GET /api/admin/advertisers/:id/wallet: the screencaster's solde as the funded
  // gates see it (total, engaged, spendable), shown in the « Créditer le compte » modal.
  app.get('/api/admin/advertisers/:id/wallet', adminGuard, async (request, reply) => {
    const parsed = idParamSchema.safeParse(request.params);
    if (!parsed.success) return invalidField(reply, 'id', 'must be a uuid');
    const target = await advertiserById(parsed.data.id);
    if (!target)
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'No such advertiser.' });
    const w = await walletSpendable(target.id);
    return reply.status(200).send({
      balance_tnd: w.balance_tnd,
      engaged_tnd: w.engaged_tnd,
      spendable_tnd: w.spendable_tnd,
      currency: 'TND',
    });
  });

  // ADM-CREDIT1 — POST /api/admin/advertisers/:id/payment-received {amount_tnd, mode, note?}:
  // money the screencaster paid outside the platform, recorded as a recharge CONFIRMED at once by
  // this admin (confirmed_by/at), reference ADM-<mode>-…, notified to the screencaster in the same
  // transaction. No ceiling, no minimum (ruling) — only > 0 and the column's capacity.
  app.post('/api/admin/advertisers/:id/payment-received', adminGuard, async (request, reply) => {
    const parsedParams = idParamSchema.safeParse(request.params);
    if (!parsedParams.success) return invalidField(reply, 'id', 'must be a uuid');
    const parsedBody = paymentBodySchema.safeParse(request.body);
    if (!parsedBody.success) {
      const issue = parsedBody.error.issues[0];
      return invalidField(reply, String(issue?.path[0] ?? 'body'), issue?.message ?? 'invalid');
    }
    const { amount_tnd: amount, mode } = parsedBody.data;
    const note = parsedBody.data.note?.trim() || null;
    if (!isValidAdminPaymentAmount(amount)) {
      return invalidField(reply, 'amount_tnd', 'amount must be > 0 with at most 2 decimals');
    }
    const adminId = request.user?.id;
    if (!adminId) {
      return reply
        .status(401)
        .send({ error: 'UNAUTHENTICATED', message: 'Authentication required.' });
    }
    const target = await advertiserById(parsedParams.data.id);
    if (!target)
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'No such advertiser.' });

    let row: Recharge | undefined;
    for (let attempt = 0; attempt < 5 && row === undefined; attempt += 1) {
      try {
        row = await db.transaction(async (tx) => {
          const now = new Date();
          const [inserted] = await tx
            .insert(recharges)
            .values({
              advertiserId: target.id,
              amountTnd: amount.toFixed(2),
              reference: adminPaymentReference(mode),
              status: 'confirmed',
              confirmedBy: adminId,
              confirmedAt: now,
            })
            .returning();
          if (!inserted) return undefined;
          await tx.insert(notifications).values(adminPaymentNotification(inserted, mode, note));
          return inserted;
        });
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
      }
    }
    if (!row) {
      return reply
        .status(500)
        .send({ error: 'INTERNAL_ERROR', message: 'Payment record write failed.' });
    }
    // Spec VF §11 — the Screencaster's agent is told of the recharge, as for any confirmed one.
    await noticeAffiliateRecharged(target.id).catch((err: unknown) =>
      request.log.warn({ err, rechargeId: row?.id }, 'agent recharge notice failed'),
    );
    return reply.status(201).send({
      id: row.id,
      reference: row.reference,
      amount_tnd: Number(row.amountTnd),
      mode,
      status: row.status,
      confirmed_at: row.confirmedAt,
    });
  });
};

const paymentBodySchema = z.object({
  amount_tnd: z.number(),
  mode: z.enum(ADMIN_PAYMENT_MODES),
  note: z.string().max(500).optional(),
});

/** The screencaster account an admin credits (404 for anyone else). */
const advertiserById = async (id: string): Promise<{ id: string } | undefined> => {
  const [target] = await db
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);
  return target && target.role === 'advertiser' ? { id: target.id } : undefined;
};
