import { and, eq, isNotNull } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';

import { db } from '../db/client.js';
import { campaignDispatchPlan, campaigns } from '../db/schema.js';

import { runRedispatchRound } from './dispatch/redispatch.js';
import { createEngineTrace } from './engine-journal/trace.js';

// E6 — the rattrapage tick: for each ACTIVE campaign with a frozen plan, run at most ONE
// redispatch round (detection → total-validation → placement, lib/dispatch/redispatch.ts). The
// lifecycle-job posture: boot tick + hourly unref'd interval, and the tick logs only when it acts
// (the round itself logs placements/skips); a per-campaign try/catch means one campaign's failure
// never starves the rest.

export interface RedispatchTickResult {
  scanned: number;
  placedRounds: number;
  failures: number;
}

export async function runCampaignRedispatchTick(
  log: FastifyBaseLogger,
  now: Date = new Date(),
): Promise<RedispatchTickResult> {
  // ACTIVE campaigns with a plan and a window (a date-less row cannot reach 'active', belt only).
  const rows = await db
    .select({
      id: campaigns.id,
      name: campaigns.name,
      startDate: campaigns.startDate,
      endDate: campaigns.endDate,
    })
    .from(campaigns)
    .innerJoin(campaignDispatchPlan, eq(campaignDispatchPlan.campaignId, campaigns.id))
    .where(
      and(
        eq(campaigns.status, 'active'),
        isNotNull(campaigns.startDate),
        isNotNull(campaigns.endDate),
      ),
    );

  let placedRounds = 0;
  let failures = 0;
  for (const row of rows) {
    if (!row.startDate || !row.endDate) continue;
    try {
      const outcome = await runRedispatchRound(
        { id: row.id, name: row.name, startDate: row.startDate, endDate: row.endDate },
        now,
        // LOG1 — journal the production ticks (flushed inside runRedispatchRound, post-tx).
        createEngineTrace('redispatch', row.id),
      );
      if (outcome.status === 'PLACED') placedRounds += 1;
    } catch (err: unknown) {
      failures += 1;
      log.warn({ err, campaignId: row.id }, 'redispatch round failed');
    }
  }
  return { scanned: rows.length, placedRounds, failures };
}

/** Boot tick + hourly unref'd interval — the campaign-lifecycle job pattern. */
export function startCampaignRedispatchJob(log: FastifyBaseLogger): void {
  void runCampaignRedispatchTick(log).catch((err: unknown) =>
    log.warn({ err }, 'campaign redispatch boot tick failed'),
  );
  const timer = setInterval(
    () => {
      void runCampaignRedispatchTick(log).catch((err: unknown) =>
        log.warn({ err }, 'campaign redispatch tick failed'),
      );
    },
    60 * 60 * 1000,
  );
  timer.unref();
}
