import { type SQL, sql } from 'drizzle-orm';

import { screenhosts, users } from '../db/schema.js';

// ELIG-2 (operator ruling 2026-09-16) — ONLY APPROVED OWNERS COUNT. A venue is eligible ANYWHERE —
// the standard dispatch pool (and through it C_max, the refusal cascade, redispatch and the
// booster), the event pool and the event ceiling C_max_evt, the advertiser coverage map and the
// admin « Hosts éligibles » view — only when its owner exists and `users.status = 'approved'`.
// Ownerless, pending, rejected and banned owners are all OUT.
//
// Why a rule of its own: `screenhosts.is_active` was the only gate, and nothing ever sets it false,
// so a venue signed up by an owner the admins had not validated (or had rejected) sat on the map
// and in the dispatch pool from the moment its row existed.
//
// THE ONE HOME. Every eligibility read ANDs this predicate into its WHERE, or selects it as a
// boolean column when it must say WHY a venue is out (pool journaling, the admin view), so no
// reader can hold a copy that drifts. A correlated EXISTS rather than a join: the callers keep
// their own FROM/JOIN shape untouched, and an ownerless venue (owner_id NULL) matches no user row,
// so it is excluded by the same clause with no special case.
//
// Deliberately NOT applied to: display/admin listings, an owner's views of their own venues, SPS
// scoring, reports and the hub sync — those describe a venue, they do not put it to work.
//
// It lives OUTSIDE lib/dispatch on purpose: the event engines are boundary-pinned (D51) against
// importing anything under dispatch/ or campaign*, and they need the very same predicate.

/** SQL boolean — TRUE iff the row's `screenhosts.owner_id` is a user whose status is 'approved'. */
export const ownerApprovedSql = (): SQL<boolean> =>
  sql<boolean>`exists (select 1 from ${users} where ${users.id} = ${screenhosts.ownerId} and ${users.status} = 'approved')`;
