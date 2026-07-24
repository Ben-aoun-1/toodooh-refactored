import { and, desc, eq, sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { db } from '../db/client.js';
import { campaigns, engineEvents, screenhosts } from '../db/schema.js';
import { requireAdmin, requireAuth } from '../middleware/require-auth.js';

// LOG1 — the admin engine-journal read: WHY the engine did what it did, per run. Runs (the
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

    const [campaign] = await db
      .select({ id: campaigns.id })
      .from(campaigns)
      .where(eq(campaigns.id, id))
      .limit(1);
    if (!campaign) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'No such campaign.' });
    }

    const runWhere = and(
      eq(engineEvents.campaignId, id),
      eq(engineEvents.eventType, 'run'),
      ...(phase ? [eq(engineEvents.phase, phase)] : []),
    );
    const [countRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(engineEvents)
      .where(runWhere);
    const runRows = await db
      .select()
      .from(engineEvents)
      .where(runWhere)
      .orderBy(desc(engineEvents.createdAt), desc(engineEvents.id))
      .limit(limit)
      .offset(offset);

    const runIds = runRows.map((r) => r.runId);
    const eventRows = runIds.length
      ? await db
          .select({
            runId: engineEvents.runId,
            eventType: engineEvents.eventType,
            screenhostId: engineEvents.screenhostId,
            screenhostName: screenhosts.name,
            payload: engineEvents.payload,
          })
          .from(engineEvents)
          .leftJoin(screenhosts, eq(screenhosts.id, engineEvents.screenhostId))
          .where(and(eq(engineEvents.campaignId, id), sql`${engineEvents.eventType} <> 'run'`))
      : [];
    const eventsByRun = new Map<string, typeof eventRows>();
    for (const e of eventRows) {
      if (!runIds.includes(e.runId)) continue;
      const list = eventsByRun.get(e.runId) ?? [];
      list.push(e);
      eventsByRun.set(e.runId, list);
    }

    // In-run order rides payload.seq (one flush batch shares created_at).
    const seqOf = (p: Record<string, unknown>): number =>
      typeof p['seq'] === 'number' ? (p['seq'] as number) : 0;

    return reply.status(200).send({
      campaign_id: id,
      total_runs: countRow?.count ?? 0,
      runs: runRows.map((run) => ({
        run_id: run.runId,
        phase: run.phase,
        outcome: run.outcome,
        started_at: run.createdAt,
        summary: run.payload,
        events: (eventsByRun.get(run.runId) ?? [])
          .sort((a, b) => seqOf(a.payload) - seqOf(b.payload))
          .map((e) => ({
            event_type: e.eventType,
            screenhost_id: e.screenhostId,
            screenhost_name: e.screenhostName,
            payload: e.payload,
          })),
      })),
    });
  });
};
