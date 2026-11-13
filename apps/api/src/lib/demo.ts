import { fromZonedTime } from 'date-fns-tz';
import { type SQL, and, eq, sql } from 'drizzle-orm';

import { db } from '../db/client.js';
import {
  campaignDispatchAllocation,
  campaigns,
  demoScreenhosts,
  dispatchConfig,
  eventAllocations,
  screenhosts,
  users,
} from '../db/schema.js';

// DEMO-1 (operator 2026-10-12, rulings A A A A A A) — demo mode. An admin creates DEMO
// screencasters (users.is_demo) with a pre-filled profile and balance; their campaigns:
//   Q1 A — are accepted on the owner's behalf: allocations land ACCEPTE, no owner notification,
//          and the settlement writes no payout nor reversement line (the owner earns nothing);
//   Q2 A — air only on the venues the admin opened to demos (demo_screenhosts);
//   Q3 A — reach the TV exactly dispatch_config.demo_delay_minutes after the cart confirm
//          (campaigns.airs_at: the playout gate holds the entry back until then, and the
//          air job (lib/demo-air.ts) re-pushes the venues the minute it passes);
//   Q4 A — go through the normal engine (they take real airtime);
//   Q6 A — live until the admin deletes the account (routes/admin-demo.ts stops them first).
// DEMO-3 (operator 2026-11-04, ruling 1B) — they may position on a match too: the event pool is
// the demo venues (eventPoolDemoVenues), the allocations land ACCEPTE with no owner told, the
// blocs move onto the demo timeline at « Lancer » (lib/demo-event.ts), the match's own moves
// leave them alone, and the owner sees, decides and earns nothing (notDemoEventAllocationSql).
// ONE home for the demo reads, so every engine path asks the same question the same way.

type Executor = typeof db | Parameters<Parameters<(typeof db)['transaction']>[0]>[0];

export const DEMO_DELAY_DEFAULT_MINUTES = 5;
export const DEMO_DELAY_MAX_MINUTES = 1440;

const TUNIS = 'Africa/Tunis';

export const isDemoUser = async (executor: Executor, userId: string): Promise<boolean> => {
  const [row] = await executor
    .select({ isDemo: users.isDemo })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row?.isDemo ?? false;
};

/** Whether the campaign belongs to a demo screencaster. */
export const isDemoCampaign = async (executor: Executor, campaignId: string): Promise<boolean> => {
  const [row] = await executor
    .select({ isDemo: users.isDemo })
    .from(campaigns)
    .innerJoin(users, eq(campaigns.advertiserId, users.id))
    .where(eq(campaigns.id, campaignId))
    .limit(1);
  return row?.isDemo ?? false;
};

/** The venues opened to demo campaigns (Q2 A): the real ones the admin ticked, plus every demo
 *  screenhost (DEMO-2 — created for demos, always open to them). */
export const demoVenueIds = async (executor: Executor): Promise<Set<string>> => {
  const rows = await executor.select({ id: demoScreenhosts.screenhostId }).from(demoScreenhosts);
  const synthetic = await executor
    .select({ id: screenhosts.id })
    .from(screenhosts)
    .where(and(eq(screenhosts.demoOnly, true), eq(screenhosts.isActive, true)));
  return new Set([...rows.map((r) => r.id), ...synthetic.map((r) => r.id)]);
};

/** SQL predicate on `screenhosts`: the row is a REAL venue (not a DEMO-2 demo screenhost). */
export const realVenueSql = (): SQL => sql`${screenhosts.demoOnly} = false`;

/** The admin-set delay between a demo cart confirm and the TV (Q3 A). */
export const demoDelayMinutes = async (executor: Executor = db): Promise<number> => {
  const [row] = await executor
    .select({ minutes: dispatchConfig.demoDelayMinutes })
    .from(dispatchConfig)
    .limit(1);
  return row?.minutes ?? DEMO_DELAY_DEFAULT_MINUTES;
};

/** Q1 A — a demo plan's allocations are accepted on the owner's behalf. */
export const acceptDemoAllocations = async (executor: Executor, planId: string): Promise<void> => {
  await executor
    .update(campaignDispatchAllocation)
    .set({ statutAcceptation: 'ACCEPTE' })
    .where(eq(campaignDispatchAllocation.planId, planId));
};

/**
 * The instant a demo campaign goes on air: `delayMinutes` after the confirm, and never before its
 * first day starts (Tunis midnight) when the screencaster picked a later start.
 */
export const demoAirsAt = (confirmedAt: Date, delayMinutes: number, startDate: string): Date => {
  const afterDelay = new Date(confirmedAt.getTime() + delayMinutes * 60_000);
  const dayStart = fromZonedTime(`${startDate}T00:00:00`, TUNIS);
  return afterDelay > dayStart ? afterDelay : dayStart;
};

/**
 * SQL predicate on campaign_dispatch_allocation: the allocation is NOT a demo campaign's. The
 * owner never decided a demo allocation (Q1 A), so the SPS acceptance rate must not count it.
 */
export const notDemoAllocationSql = (): SQL =>
  sql`NOT EXISTS (SELECT 1 FROM ${campaigns} JOIN ${users} ON ${users.id} = ${campaigns.advertiserId}
    JOIN campaign_dispatch_plan demo_plan ON demo_plan.campaign_id = ${campaigns.id}
    WHERE demo_plan.id = ${campaignDispatchAllocation.planId} AND ${users.isDemo})`;

/** SQL predicate on `campaigns`: the campaign is NOT a demo screencaster's. */
export const notDemoCampaignSql = (): SQL =>
  sql`NOT EXISTS (SELECT 1 FROM ${users} WHERE ${users.id} = ${campaigns.advertiserId} AND ${users.isDemo})`;

/**
 * DEMO-3 — SQL predicate on event_allocations: the allocation is NOT a demo positioning's. Like
 * notDemoAllocationSql: the owner never saw nor decided it, so no owner reader counts it.
 */
export const notDemoEventAllocationSql = (): SQL =>
  sql`NOT EXISTS (SELECT 1 FROM ${campaigns} JOIN ${users} ON ${users.id} = ${campaigns.advertiserId}
    WHERE ${campaigns.id} = ${eventAllocations.campaignId} AND ${users.isDemo})`;

/** DEMO-3 — a positioning's event pool: its demo screencaster's demo venues, or null (the real network). */
export const eventPoolDemoVenues = async (
  executor: Executor,
  campaignId: string,
): Promise<ReadonlySet<string> | null> =>
  (await isDemoCampaign(executor, campaignId)) ? demoVenueIds(executor) : null;

/** DEMO-3 — the same, for a screencaster browsing the catalogue (no positioning yet). */
export const eventPoolDemoVenuesForUser = async (
  executor: Executor,
  userId: string,
): Promise<ReadonlySet<string> | null> =>
  (await isDemoUser(executor, userId)) ? demoVenueIds(executor) : null;
