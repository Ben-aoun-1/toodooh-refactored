import { type Name, type SQL, sql } from 'drizzle-orm';

import { screenhosts, screens } from '../db/schema.js';

// MAP-TV1 (operator ruling 2026-09-21, M1 A · M2 A) — a venue is SELLABLE only when it has AT
// LEAST ONE INSTALLED screen. Installed is ADM-FIX1's definition, unchanged: a `screens` row whose
// `paired_at IS NOT NULL OR last_seen_at IS NOT NULL` — either proof that a real device once ran
// against it (the admin « Écrans » listing counts `installed_count` with the very same clause, in
// routes/admin-screenhosts.ts). A row alone is a declaration, not a TV: `screens.is_active`
// defaults to true and nothing writes it, so it is deliberately NOT part of the rule.
//
// Why: nothing that sold or placed a campaign checked for a TV. The advertiser coverage map,
// C_max and the dispatch pool counted venues that never had the APK (no row, no login, no proof),
// so reach was overstated and dispatch could hand a share to a venue where nothing can air.
//
// THE ONE HOME, next to ownerApprovedSql (lib/approved-owner.ts) and venueHasAffluenceSql
// (lib/venue-has-affluence.ts), and the same shape: a correlated EXISTS on `screenhosts.id`, so a
// reader ANDs it into its own WHERE — or selects it as a boolean column when it must say WHY a
// venue is out (the pool's journal → « Hosts éligibles » 'no_installed_screen') — without
// touching its FROM shape. It lives OUTSIDE lib/dispatch on purpose: the event engines are
// boundary-pinned (D51) against importing anything under dispatch/ or campaign*, and they read
// the very same predicate.
//
// Applied wherever a venue is SOLD or PLACED: the dispatch pool (and through it dispatch, C_max,
// the refusal cascade, redispatch, the classic booster and the eligibility view), the event
// ceiling C_max_evt, the event bloc pool (event dispatch, its refusal cascade, the event booster)
// and the coverage map. It gates NEW placements and the previews only: allocations that already
// exist are never revisited (settlement, playout, owner decisions and reports read them as they
// are). It is not a liveness test — redispatch keeps its own, stricter heartbeat rule on
// `last_seen_at` for replacements.

// ⚠️ Every column is written TABLE-QUALIFIED by hand. Drizzle renders a column interpolated into
// `sql` UNqualified when it sits in the SELECT list of a single-table query (assemblePool selects
// this predicate as a column), and an unqualified "id" inside the subquery binds to screens.id,
// not to the outer venue: the probe would then be false for every venue. Qualifying explicitly
// keeps the correlation whether a reader selects the predicate or filters on it.
const column = (c: { name: string }): Name => sql.identifier(c.name);

/** SQL boolean — TRUE iff one of the row's venue's screens was ever paired or ever seen. */
export const venueHasInstalledScreenSql = (): SQL<boolean> =>
  sql<boolean>`exists (select 1 from ${screens} where ${screens}.${column(screens.screenhostId)} = ${screenhosts}.${column(screenhosts.id)} and (${screens}.${column(screens.pairedAt)} is not null or ${screens}.${column(screens.lastSeenAt)} is not null))`;
