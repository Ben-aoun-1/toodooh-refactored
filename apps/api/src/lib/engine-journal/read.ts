import { and, desc, eq, sql } from 'drizzle-orm';

import { db } from '../../db/client.js';
import { campaigns, engineEvents, screenhosts } from '../../db/schema.js';

import type { EnginePhase } from './trace.js';

// LOG1 — the engine-journal READ, one home: the admin route (GET /api/admin/campaigns/:id/
// engine-journal) and the simulator's campaign inspector (SIM-6) both call it. Extracted verbatim
// from the route. Runs (the event_type='run' summary rows) come newest-first; each carries its
// events in emission (seq) order, venue-named. null = no such campaign.

export interface EngineJournalQuery {
  phase?: EnginePhase;
  limit: number;
  offset: number;
}

export const readEngineJournal = async (campaignId: string, query: EngineJournalQuery) => {
  const { phase, limit, offset } = query;
  const [campaign] = await db
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(eq(campaigns.id, campaignId))
    .limit(1);
  if (!campaign) return null;

  const runWhere = and(
    eq(engineEvents.campaignId, campaignId),
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
        .where(
          and(eq(engineEvents.campaignId, campaignId), sql`${engineEvents.eventType} <> 'run'`),
        )
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

  return {
    campaign_id: campaignId,
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
  };
};
