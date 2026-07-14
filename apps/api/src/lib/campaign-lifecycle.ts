import { and, eq, isNotNull, lt, lte } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';

import { db } from '../db/client.js';
import { campaigns } from '../db/schema.js';

import { tunisDateOf } from './campaign-dates.js';

// CF-S1 (spec §3.1/3.2) — the stored-status lifecycle: admin approval routes a future-dated
// campaign to 'upcoming'; this job flips upcoming→active when the window opens and
// active→completed when it closes. Set-based single UPDATEs, idempotent by construction (a
// re-run matches zero rows), Tunis calendar dates like the rest of the campaign date rules.

/**
 * Settlement seam — deliberately a NO-OP: the reconcile/payout auto-trigger at completion is
 * BANKED pending an operator ruling (money-adjacent). The lifecycle job calls it per completed
 * campaign so the wiring point exists and is tested; nothing happens here yet.
 */
export function onCampaignCompleted(campaignId: string): void {
  void campaignId; // intentionally unused — see the seam note above
}

export interface LifecycleTickResult {
  activated: number;
  completed: number;
}

/** One transition pass. Order matters: an over-slept 'upcoming' whose whole window already
 * passed flips to 'active' first, then the completion pass catches it in the SAME tick. */
export async function runCampaignLifecycleTick(
  log: FastifyBaseLogger,
  now: Date = new Date(),
  // Injectable so tests can observe the seam (ESM local bindings defeat namespace spies).
  onCompleted: (campaignId: string) => void = onCampaignCompleted,
): Promise<LifecycleTickResult> {
  const today = tunisDateOf(now);

  const activated = await db
    .update(campaigns)
    .set({ status: 'active' })
    .where(and(eq(campaigns.status, 'upcoming'), lte(campaigns.startDate, today)))
    .returning({ id: campaigns.id });

  const completed = await db
    .update(campaigns)
    .set({ status: 'completed' })
    .where(
      and(
        eq(campaigns.status, 'active'),
        isNotNull(campaigns.endDate),
        lt(campaigns.endDate, today),
      ),
    )
    .returning({ id: campaigns.id });

  for (const c of completed) onCompleted(c.id);

  if (activated.length > 0 || completed.length > 0) {
    log.info(
      { activated: activated.length, completed: completed.length, today },
      'campaign lifecycle tick applied transitions',
    );
  }
  return { activated: activated.length, completed: completed.length };
}

/** Boot + hourly unref'd interval (the sweepUnexported pattern) — never holds the process open. */
export function startCampaignLifecycleJob(log: FastifyBaseLogger): void {
  void runCampaignLifecycleTick(log).catch((err: unknown) =>
    log.warn({ err }, 'campaign lifecycle boot tick failed'),
  );
  const timer = setInterval(
    () => {
      void runCampaignLifecycleTick(log).catch((err: unknown) =>
        log.warn({ err }, 'campaign lifecycle tick failed'),
      );
    },
    60 * 60 * 1000,
  );
  timer.unref();
}
