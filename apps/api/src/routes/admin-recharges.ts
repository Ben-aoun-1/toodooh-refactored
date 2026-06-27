import { and, desc, eq } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { db } from '../db/client.js';
import { type Recharge, recharges } from '../db/schema.js';
import { adminRechargeView } from '../lib/recharges.js';
import { requireAdmin, requireAuth } from '../middleware/require-auth.js';

// Admin recharge moderation (L-wallet) — the manual-payment confirmation step. An admin reconciles a
// bank transfer against a recharge's reference and CONFIRMS receipt (→ credits the derived balance)
// or REJECTS it (→ a reason surfaced to the advertiser). Mirrors the admin creative/account review:
// every route is [requireAuth, requireAdmin]; a non-admin gets 403, a missing recharge 404. Both
// transitions are pending→x only — a confirm/reject of a non-pending recharge 409s, and the UPDATE's
// WHERE status='pending' makes the confirm ATOMIC (a re-confirm can never double-credit).

const idParamSchema = z.object({ id: z.uuid() });
const listQuerySchema = z.object({
  status: z.enum(['pending', 'confirmed', 'rejected']).optional(),
});
const rejectBodySchema = z.object({ reason: z.string().trim().min(1).max(2000) });

const invalidField = (reply: FastifyReply, field: string, reason: string) =>
  reply
    .status(400)
    .send({ error: 'INVALID_INPUT', message: 'Validation failed', fields: [{ field, reason }] });

// 409 for a recharge that is no longer pending (already confirmed/rejected). Carries the current
// status so the admin UI can show "already confirmed/rejected" instead of a blind retry.
const sendNotPending = (reply: FastifyReply, request: FastifyRequest, row: Recharge) =>
  reply.status(409).send({
    error: 'CONFLICT',
    message: `Recharge already ${row.status}.`,
    statusCode: 409,
    requestId: request.id,
    currentStatus: row.status,
  });

export const adminRechargesRoutes: FastifyPluginAsync = async (app) => {
  const adminGuard = { preHandler: [requireAuth, requireAdmin] };

  // GET /api/admin/recharges[?status=] — the moderation queue (newest first); optional status filter.
  app.get('/api/admin/recharges', adminGuard, async (request, reply) => {
    const parsedQuery = listQuerySchema.safeParse(request.query);
    if (!parsedQuery.success) {
      return invalidField(reply, 'status', 'must be pending, confirmed or rejected');
    }
    const { status } = parsedQuery.data;
    const rows = await db
      .select()
      .from(recharges)
      .where(status ? eq(recharges.status, status) : undefined)
      .orderBy(desc(recharges.createdAt));
    return reply.status(200).send(rows.map(adminRechargeView));
  });

  // POST /api/admin/recharges/:id/confirm — pending → confirmed; credits the balance + stamps the
  // confirm audit (confirmed_by/at). Idempotent: a second confirm 409s and never double-credits.
  app.post('/api/admin/recharges/:id/confirm', adminGuard, async (request, reply) => {
    const parsedParams = idParamSchema.safeParse(request.params);
    if (!parsedParams.success) return invalidField(reply, 'id', 'must be a uuid');
    const adminId = request.user?.id;
    if (!adminId) {
      return reply
        .status(401)
        .send({ error: 'UNAUTHENTICATED', message: 'Authentication required.' });
    }
    const { id } = parsedParams.data;
    const [existing] = await db.select().from(recharges).where(eq(recharges.id, id)).limit(1);
    if (!existing)
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'No such recharge.' });
    if (existing.status !== 'pending') return sendNotPending(reply, request, existing);

    const [updated] = await db
      .update(recharges)
      .set({ status: 'confirmed', confirmedBy: adminId, confirmedAt: new Date() })
      // Guard the transition in the WHERE so two concurrent confirms can't both win (atomic, no
      // double-credit). A lost race returns 0 rows → re-read + 409.
      .where(and(eq(recharges.id, id), eq(recharges.status, 'pending')))
      .returning();
    if (!updated) {
      const [current] = await db.select().from(recharges).where(eq(recharges.id, id)).limit(1);
      return sendNotPending(reply, request, current ?? existing);
    }
    return reply.status(200).send(adminRechargeView(updated));
  });

  // POST /api/admin/recharges/:id/reject {reason} — pending → rejected; a reason is REQUIRED and is
  // surfaced to the advertiser (reject_reason). Does NOT credit the balance.
  app.post('/api/admin/recharges/:id/reject', adminGuard, async (request, reply) => {
    const parsedParams = idParamSchema.safeParse(request.params);
    if (!parsedParams.success) return invalidField(reply, 'id', 'must be a uuid');
    const parsedBody = rejectBodySchema.safeParse(request.body ?? {});
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
    const adminId = request.user?.id;
    if (!adminId) {
      return reply
        .status(401)
        .send({ error: 'UNAUTHENTICATED', message: 'Authentication required.' });
    }
    const { id } = parsedParams.data;
    const [existing] = await db.select().from(recharges).where(eq(recharges.id, id)).limit(1);
    if (!existing)
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'No such recharge.' });
    if (existing.status !== 'pending') return sendNotPending(reply, request, existing);

    const [updated] = await db
      .update(recharges)
      .set({ status: 'rejected', rejectReason: parsedBody.data.reason })
      .where(and(eq(recharges.id, id), eq(recharges.status, 'pending')))
      .returning();
    if (!updated) {
      const [current] = await db.select().from(recharges).where(eq(recharges.id, id)).limit(1);
      return sendNotPending(reply, request, current ?? existing);
    }
    return reply.status(200).send(adminRechargeView(updated));
  });
};
