import { desc } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { db } from '../db/client.js';
import { agentNews } from '../db/schema.js';
import { publishAgentNews } from '../lib/agent-notifications.js';
import { requireAuth, requireRole } from '../middleware/require-auth.js';

// AGT-6 (agent specs v1.0 §8 « Actualité Toodooh ») — the hub publishes news to the agents.

const staffGuard = { preHandler: [requireAuth, requireRole('admin', 'superadmin')] };
const newsSchema = z.object({
  title: z.string().trim().min(1).max(160),
  body: z.string().trim().min(1).max(2000),
  audience: z.enum(['all', 'screencast_agent', 'screenhost_agent']),
});

export const agentNewsRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/admin/agent-news', staffGuard, async (_request, reply) => {
    const rows = await db.select().from(agentNews).orderBy(desc(agentNews.publishedAt)).limit(50);
    return reply.status(200).send({
      news: rows.map((n) => ({
        id: n.id,
        title: n.title,
        body: n.body,
        audience: n.audience,
        published_at: n.publishedAt.toISOString(),
      })),
    });
  });

  app.post('/api/admin/agent-news', staffGuard, async (request, reply) => {
    const body = newsSchema.safeParse(request.body ?? {});
    if (!body.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        fields: body.error.issues.map((i) => ({ field: i.path.join('.'), reason: i.message })),
      });
    }
    return reply.status(201).send(await publishAgentNews(body.data, request.user?.id ?? null));
  });
};
