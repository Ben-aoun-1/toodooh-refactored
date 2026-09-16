import { type SQL, sql } from 'drizzle-orm';

import { screenhostAffluence, screenhostAffluenceHourly, screenhosts } from '../db/schema.js';

import { inEffectSql } from './half-hour-slots.js';

// MAP-4 (Mejri/operator 2026-09-16) — does a venue have AT LEAST ONE affluence value, manual or
// live? The advertiser coverage map shows a venue only when it does: a venue with nothing but
// zeros and NULLs has no audience to sell, and a dot for it promises reach that does not exist.
//
//   • manual — any typical-week grid cell (screenhost_affluence) worth > 0 AND in effect: a cell
//     the hub suspended (in_effect = false) is ABSENT, the same OFF-1 predicate the pool reads Ai
//     through (inEffectSql);
//   • live   — any measured slot (screenhost_affluence_hourly) worth > 0. A NULL value is « the
//     sensor reported nothing », never a reading, and `> 0` already leaves it out.
//
// One value anywhere is enough. Correlated EXISTS on `screenhosts.id`, so a reader ANDs it into
// its own WHERE without changing its FROM shape, and each probe stops at its first match on the
// tables' (screenhost_id, …) indexes.

/** SQL boolean — TRUE iff the row's venue has one manual in-effect value > 0 or one live value > 0. */
export const venueHasAffluenceSql = (): SQL<boolean> =>
  sql<boolean>`(exists (select 1 from ${screenhostAffluence} where ${screenhostAffluence.screenhostId} = ${screenhosts.id} and ${screenhostAffluence.estimatedImpressions} > 0 and ${inEffectSql(screenhostAffluence.inEffect)}) or exists (select 1 from ${screenhostAffluenceHourly} where ${screenhostAffluenceHourly.screenhostId} = ${screenhosts.id} and ${screenhostAffluenceHourly.value} > 0))`;
