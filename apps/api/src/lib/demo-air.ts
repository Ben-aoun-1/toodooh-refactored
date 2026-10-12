import { and, eq, inArray, isNull, lte } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';

import { db } from '../db/client.js';
import { campaigns } from '../db/schema.js';

import { tunisDateOf } from './campaign-dates.js';
import { pushPlaylistToCampaignVenues } from './playout/push.js';

// DEMO-1 (ruled Q3 A) — puts demo campaigns on the TVs the minute their airs_at passes
// (lib/demo.ts holds the rulings). The playout gate already holds an entry back until airs_at;
// this job is what makes a CONNECTED screen receive it on time instead of at its next reconnect.

/**
 * The air tick: every demo campaign whose airs_at has passed and that was not pushed yet goes on
 * the TVs now — a future-dated one whose first day has come flips upcoming → active first (the
 * hourly lifecycle job would be up to an hour late) — then airs_pushed_at is stamped, so each
 * campaign is pushed once. Returns the campaigns pushed.
 */
export const runDemoAirTick = async (
  log?: FastifyBaseLogger,
  now = new Date(),
): Promise<number> => {
  const due = await db
    .select({ id: campaigns.id, status: campaigns.status, startDate: campaigns.startDate })
    .from(campaigns)
    .where(
      and(
        lte(campaigns.airsAt, now),
        isNull(campaigns.airsPushedAt),
        inArray(campaigns.status, ['upcoming', 'active']),
      ),
    );
  const today = tunisDateOf(now);
  let pushed = 0;
  for (const c of due) {
    if (c.status === 'upcoming') {
      if (c.startDate === null || c.startDate > today) continue;
      await db
        .update(campaigns)
        .set({ status: 'active' })
        .where(and(eq(campaigns.id, c.id), eq(campaigns.status, 'upcoming')));
    }
    await pushPlaylistToCampaignVenues(c.id, log);
    await db.update(campaigns).set({ airsPushedAt: now }).where(eq(campaigns.id, c.id));
    pushed += 1;
  }
  if (pushed > 0) log?.info({ pushed }, 'demo campaigns put on air');
  return pushed;
};

/** Boot + 15 s unref'd interval: the delay is set in minutes, so a push lands within 15 s of it. */
export function startDemoAirJob(log: FastifyBaseLogger): void {
  const tick = () =>
    void runDemoAirTick(log).catch((err: unknown) => log.warn({ err }, 'demo air tick failed'));
  tick();
  const timer = setInterval(tick, 15_000);
  timer.unref();
}
