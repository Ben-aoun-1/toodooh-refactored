import { desc, eq } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { z } from 'zod';

import { db } from '../db/client.js';
import { screenhostMonthlyStatements, screenhosts } from '../db/schema.js';
import { requireActiveAccount, requireAuth } from '../middleware/require-auth.js';
import { storage } from '../storage/s3-storage.js';

// FCT2 — the owner's « Relevés de reversement »: monthly per-venue statements written by the
// month-end billing sweep. Owner-level list (all the caller's venues, the /screenhosts/earnings
// posture) + a stored-PDF download served THROUGH the api (the monthly-report posture — private
// prefix, never presigned). Replaces the mock-fed client-side jsPDF relevé.

const idParamSchema = z.object({ id: z.uuid() });

const invalidField = (reply: FastifyReply, field: string, reason: string) =>
  reply
    .status(400)
    .send({ error: 'INVALID_INPUT', message: 'Validation failed', fields: [{ field, reason }] });

const sendUnauthenticated = (reply: FastifyReply) =>
  reply.status(401).send({ error: 'UNAUTHENTICATED', message: 'Authentication required.' });

export const ownerStatementsRoutes: FastifyPluginAsync = async (app) => {
  const ownerGuard = { preHandler: [requireAuth, requireActiveAccount] };

  // GET /api/screenhosts/statements — every relevé across the caller's venues, newest month first.
  app.get('/api/screenhosts/statements', ownerGuard, async (request, reply) => {
    const userId = request.user?.id;
    if (!userId) return sendUnauthenticated(reply);
    const rows = await db
      .select({
        id: screenhostMonthlyStatements.id,
        screenhost_id: screenhostMonthlyStatements.screenhostId,
        screenhost_name: screenhosts.name,
        month: screenhostMonthlyStatements.month,
        total_sh_tnd: screenhostMonthlyStatements.totalShTnd,
        reference: screenhostMonthlyStatements.reference,
        created_at: screenhostMonthlyStatements.createdAt,
      })
      .from(screenhostMonthlyStatements)
      .innerJoin(screenhosts, eq(screenhosts.id, screenhostMonthlyStatements.screenhostId))
      .where(eq(screenhosts.ownerId, userId))
      .orderBy(
        desc(screenhostMonthlyStatements.month),
        desc(screenhostMonthlyStatements.createdAt),
      );
    return reply
      .status(200)
      .send(rows.map((r) => ({ ...r, total_sh_tnd: Number(r.total_sh_tnd) })));
  });

  // GET /api/screenhosts/statements/:id/pdf — stream the stored relevé. Ownership rides the join:
  // a foreign statement is indistinguishable from a missing one — one identical 404.
  app.get('/api/screenhosts/statements/:id/pdf', ownerGuard, async (request, reply) => {
    const parsed = idParamSchema.safeParse(request.params);
    if (!parsed.success) return invalidField(reply, 'id', 'must be a uuid');
    const userId = request.user?.id;
    if (!userId) return sendUnauthenticated(reply);

    const [row] = await db
      .select({
        pdfKey: screenhostMonthlyStatements.pdfKey,
        reference: screenhostMonthlyStatements.reference,
        ownerId: screenhosts.ownerId,
      })
      .from(screenhostMonthlyStatements)
      .innerJoin(screenhosts, eq(screenhosts.id, screenhostMonthlyStatements.screenhostId))
      .where(eq(screenhostMonthlyStatements.id, parsed.data.id))
      .limit(1);
    if (!row || row.ownerId !== userId) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'No such statement.' });
    }
    const result = await storage.download({ key: row.pdfKey });
    if ('error' in result) {
      return reply.status(502).send({
        error: 'STORAGE_ERROR',
        message: 'Could not fetch the statement. Please retry.',
      });
    }
    return reply
      .status(200)
      .header('content-type', 'application/pdf')
      .header('content-disposition', `inline; filename="releve-${row.reference}.pdf"`)
      .send(result.body);
  });
};
