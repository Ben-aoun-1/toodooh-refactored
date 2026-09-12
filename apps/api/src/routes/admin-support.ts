import { and, desc, eq } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { z } from 'zod';

import { db } from '../db/client.js';
import { supportMessages, users } from '../db/schema.js';
import { requireAdmin, requireAuth } from '../middleware/require-auth.js';

// SUP-1 — the admin « Support » queue: every message / appointment wish, newest first, and ONE
// transition (new → handled) re-encoded in the UPDATE's WHERE so two admins cannot both win
// (the admin-factures idiom; a lost race 409s in French).

const idParamSchema = z.object({ id: z.uuid() });
const listQuerySchema = z.object({ status: z.enum(['new', 'handled']).optional() });

const invalidField = (reply: FastifyReply, field: string, reason: string) =>
  reply
    .status(400)
    .send({ error: 'INVALID_INPUT', message: 'Validation failed', fields: [{ field, reason }] });
const sendUnauthenticated = (reply: FastifyReply) =>
  reply.status(401).send({ error: 'UNAUTHENTICATED', message: 'Authentication required.' });

export const adminSupportRoutes: FastifyPluginAsync = async (app) => {
  const adminGuard = { preHandler: [requireAuth, requireAdmin] };

  app.get('/api/admin/support', adminGuard, async (request, reply) => {
    const parsed = listQuerySchema.safeParse(request.query);
    if (!parsed.success) return invalidField(reply, 'status', 'must be new or handled');
    const rows = await db
      .select({
        id: supportMessages.id,
        kind: supportMessages.kind,
        objective: supportMessages.objective,
        other_detail: supportMessages.otherDetail,
        message: supportMessages.message,
        appointment_date: supportMessages.appointmentDate,
        status: supportMessages.status,
        handled_at: supportMessages.handledAt,
        created_at: supportMessages.createdAt,
        user_id: users.id,
        user_email: users.email,
        user_role: users.role,
        business_name: users.businessName,
        contact_name: users.contactName,
      })
      .from(supportMessages)
      .innerJoin(users, eq(users.id, supportMessages.userId))
      .where(parsed.data.status ? eq(supportMessages.status, parsed.data.status) : undefined)
      .orderBy(desc(supportMessages.createdAt));
    return reply.status(200).send(
      rows.map((r) => ({
        ...r,
        account_label: r.business_name || r.contact_name,
        handled_at: r.handled_at ? r.handled_at.toISOString() : null,
        created_at: r.created_at.toISOString(),
      })),
    );
  });

  app.post('/api/admin/support/:id/handled', adminGuard, async (request, reply) => {
    const parsed = idParamSchema.safeParse(request.params);
    if (!parsed.success) return invalidField(reply, 'id', 'must be a uuid');
    const adminId = request.user?.id;
    if (!adminId) return sendUnauthenticated(reply);
    const [flipped] = await db
      .update(supportMessages)
      .set({ status: 'handled', handledBy: adminId, handledAt: new Date() })
      .where(and(eq(supportMessages.id, parsed.data.id), eq(supportMessages.status, 'new')))
      .returning({ id: supportMessages.id, status: supportMessages.status });
    if (flipped) return reply.status(200).send(flipped);
    const [existing] = await db
      .select({ status: supportMessages.status })
      .from(supportMessages)
      .where(eq(supportMessages.id, parsed.data.id))
      .limit(1);
    if (!existing) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'No such message.' });
    }
    return reply.status(409).send({
      error: 'CONFLICT',
      message: 'Ce message a déjà été traité.',
      statusCode: 409,
      currentStatus: existing.status,
    });
  });
};
