import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { readEngineJournal } from '../lib/engine-journal/read.js';
import { requireAdmin, requireAuth } from '../middleware/require-auth.js';

// LOG1 — the admin engine-journal read (SIM-6: the query lives in lib/engine-journal/read.ts): WHY the engine did what it did, per run. Runs (the
// event_type='run' summary rows) come newest-first; each carries its events in emission (seq)
// order, venue-named. The repo had NO pagination idiom (every list is a bare array), but a
// journal grows per engine run — so this endpoint takes a minimal limit/offset pair with an
// enveloped response; ?phase= narrows to one engine phase.

const idParamSchema = z.object({ id: z.uuid() });
const querySchema = z.object({
  phase: z.enum(['dispatch', 'cascade', 'redispatch', 'settlement', 'boost']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export const adminEngineJournalRoutes: FastifyPluginAsync = async (app) => {
  const adminGuard = { preHandler: [requireAuth, requireAdmin] };

  app.get('/api/admin/campaigns/:id/engine-journal', adminGuard, async (request, reply) => {
    const parsedParams = idParamSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        fields: [{ field: 'id', reason: 'must be a uuid' }],
      });
    }
    const parsedQuery = querySchema.safeParse(request.query ?? {});
    if (!parsedQuery.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        fields: parsedQuery.error.issues.map((i) => ({
          field: i.path.join('.'),
          reason: i.message,
        })),
      });
    }
    const { id } = parsedParams.data;
    const { phase, limit, offset } = parsedQuery.data;

    const journal = await readEngineJournal(id, { ...(phase ? { phase } : {}), limit, offset });
    if (!journal) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'No such campaign.' });
    }
    return reply.status(200).send(journal);
  });
};
