import { and, eq, gt, inArray, isNull, lte, or } from 'drizzle-orm';

import { type DrizzleDb, db } from '../db/client.js';
import { campaigns, casterVenueExclusions } from '../db/schema.js';

// Mariem 17/11/2026 — « Réseau Screenhosts » : a Screencaster's excluded venues, ONE home.
//
// The rule (her email, « Dispatching »):
//   • the list a Screencaster edits applies from the moment he confirms, and to him alone;
//   • a campaign ALREADY VALIDATED (past, running or to come) keeps the list in force when it was
//     launched, and a booster on it uses that same list;
//   • a campaign NOT YET VALIDATED (draft, cart) follows the current list: an excluded venue
//     leaves its eligible pool, a reintegrated one comes back.
//
// « Validated » is `campaigns.submitted_at` (set when the draft is submitted or the cart is paid).
// Exclusions are stored as PERIODS (excluded_at → reintegrated_at), so the list in force at any
// instant is a read, never a copy to keep in sync: for a submitted campaign, the periods covering
// its submitted_at; for a draft, the open periods. Every engine reader (the standard pool, the
// match pool and its ceiling, the coverage map) goes through casterExcludedVenues below.
//
// It lives OUTSIDE lib/dispatch and lib/event-* on purpose (like lib/approved-owner.ts): both
// engines need the very same answer.

type Executor = DrizzleDb | Parameters<Parameters<DrizzleDb['transaction']>[0]>[0];

/** The periods of `advertiserId` in force at `at` (null = now: the open periods). */
const exclusionsInForce = async (
  executor: Executor,
  advertiserId: string,
  at: Date | null,
): Promise<Set<string>> => {
  const rows = await executor
    .select({ screenhostId: casterVenueExclusions.screenhostId })
    .from(casterVenueExclusions)
    .where(
      and(
        eq(casterVenueExclusions.advertiserId, advertiserId),
        at === null
          ? isNull(casterVenueExclusions.reintegratedAt)
          : and(
              lte(casterVenueExclusions.excludedAt, at),
              or(
                isNull(casterVenueExclusions.reintegratedAt),
                gt(casterVenueExclusions.reintegratedAt, at),
              ),
            ),
      ),
    );
  return new Set(rows.map((r) => r.screenhostId));
};

/** The venues the Screencaster has excluded right now (his « Réseau Screenhosts » page, and a
 *  match he prices before any positioning exists). */
export const casterExcludedVenuesNow = (
  executor: Executor,
  advertiserId: string,
): Promise<Set<string>> => exclusionsInForce(executor, advertiserId, null);

/** The venues out of THIS campaign's pool: its Screencaster's list at its validation, or his
 *  current list while it is still a draft. An unknown campaign excludes nothing. */
export const casterExcludedVenues = async (
  executor: Executor,
  campaignId: string,
): Promise<Set<string>> => {
  const [c] = await executor
    .select({ advertiserId: campaigns.advertiserId, submittedAt: campaigns.submittedAt })
    .from(campaigns)
    .where(eq(campaigns.id, campaignId))
    .limit(1);
  if (!c) return new Set();
  return exclusionsInForce(executor, c.advertiserId, c.submittedAt);
};

/** Both sets joined (a caller's own exclusions plus the Screencaster's). */
export const withCasterExclusions = async (
  executor: Executor,
  campaignId: string,
  own: ReadonlySet<string> = new Set(),
): Promise<Set<string>> => new Set([...own, ...(await casterExcludedVenues(executor, campaignId))]);

/** Opens an exclusion period for each venue not already excluded. Returns the ids now excluded. */
export const excludeVenues = async (
  advertiserId: string,
  screenhostIds: readonly string[],
): Promise<string[]> => {
  const ids = [...new Set(screenhostIds)];
  if (ids.length === 0) return [];
  await db
    .insert(casterVenueExclusions)
    .values(ids.map((screenhostId) => ({ advertiserId, screenhostId })))
    .onConflictDoNothing();
  return ids;
};

/** Closes the open period of each venue. Returns how many were reintegrated. */
export const reintegrateVenues = async (
  advertiserId: string,
  screenhostIds: readonly string[],
): Promise<number> => {
  if (screenhostIds.length === 0) return 0;
  const closed = await db
    .update(casterVenueExclusions)
    .set({ reintegratedAt: new Date() })
    .where(
      and(
        eq(casterVenueExclusions.advertiserId, advertiserId),
        inArray(casterVenueExclusions.screenhostId, [...screenhostIds]),
        isNull(casterVenueExclusions.reintegratedAt),
      ),
    )
    .returning({ id: casterVenueExclusions.id });
  return closed.length;
};
