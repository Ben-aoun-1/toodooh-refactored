import { and, desc, eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { db } from '../db/client.js';
import { type Notification, notifications } from '../db/schema.js';
import { requireAuth } from '../middleware/require-auth.js';

// In-app notification feed, session-user-scoped (greenfield — NOT the parked feat/remaining-gaps
// backend). GET lists the caller's notifications (newest first); POST /:id/read marks one read by
// stamping read_at. Both scope to request.user.id in the WHERE, so a caller can never read or mark
// another user's notification — a foreign/missing id is an indistinguishable 404 on /read.
const idParamSchema = z.object({ id: z.uuid() });

// Wire shape is snake_case (FE contract). read_at is an ISO string or null.
const notificationView = (row: Notification) => ({
  id: row.id,
  type: row.type,
  title: row.title,
  body: row.body,
  campaign_id: row.campaignId,
  read_at: row.readAt ? row.readAt.toISOString() : null,
  created_at: row.createdAt.toISOString(),
});

export const notificationsRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/notifications — the caller's notifications, newest first.
  app.get('/api/notifications', { preHandler: requireAuth }, async (request, reply) => {
    const userId = request.user?.id;
    if (!userId) {
      return reply
        .status(401)
        .send({ error: 'UNAUTHENTICATED', message: 'Authentication required.' });
    }
    const rows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, userId))
      .orderBy(desc(notifications.createdAt));
    return reply.status(200).send(rows.map(notificationView));
  });

  // POST /api/notifications/:id/read — mark the caller's own notification read (idempotent). Owner
  // scoping in the WHERE: a foreign/missing id returns 404, indistinguishable.
  app.post('/api/notifications/:id/read', { preHandler: requireAuth }, async (request, reply) => {
    const parsedParams = idParamSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        fields: [{ field: 'id', reason: 'must be a uuid' }],
      });
    }
    const userId = request.user?.id;
    if (!userId) {
      return reply
        .status(401)
        .send({ error: 'UNAUTHENTICATED', message: 'Authentication required.' });
    }

    const [updated] = await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.id, parsedParams.data.id), eq(notifications.userId, userId)))
      .returning();
    if (!updated) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'No such notification.' });
    }
    return reply.status(200).send(notificationView(updated));
  });
};
