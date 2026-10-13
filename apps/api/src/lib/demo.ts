import { fromZonedTime } from 'date-fns-tz';
import { type SQL, and, eq, sql } from 'drizzle-orm';

import { db } from '../db/client.js';
import {
  campaignDispatchAllocation,
  campaigns,
  demoScreenhosts,
  dispatchConfig,
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
