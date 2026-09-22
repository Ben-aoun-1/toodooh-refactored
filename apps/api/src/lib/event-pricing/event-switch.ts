import { type SQL, isNotNull } from 'drizzle-orm';

import { screenhosts } from '../../db/schema.js';

// CAP-EVT1 (operator ruling 2026-09-22) — « Capacité de diffusion » (screenhosts.broadcast_capacity)
// is the venue's EVENT SWITCH: « when we set that to 1 on a screenhost it means that he is eligible
// to dispatch events ». Its numeric value is unused; SET (not NULL) is the whole rule.
//
// THE ONE HOME of that rule, in the event module (D51: nothing here imports lib/dispatch or a
// campaign lib). The event pool (eventEligibleVenues, lib/event-pricing/pricing.ts) ANDs the SQL
// form into its WHERE, and through it the event ceiling C_max_evt, event dispatch, the event
// refusal cascade, the event booster and the event page's coverage map read it; the admin
// « Hosts éligibles » event branch reads the JS twin to say why a venue is out.
//
// Standard campaigns never read it: the dispatch pool, C_max, the cascade, redispatch, the
// classic booster and the standard coverage map sell a venue whatever its capacity says.

/** SQL boolean — TRUE iff the row's venue has its event switch on (a capacity is set). */
export const eventSwitchOnSql = (): SQL => isNotNull(screenhosts.broadcastCapacity);

/** The JS twin of eventSwitchOnSql, for a capacity already read. */
export const isEventSwitchOn = (broadcastCapacity: number | null): boolean =>
  broadcastCapacity !== null;
