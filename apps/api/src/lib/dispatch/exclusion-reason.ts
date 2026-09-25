import {
  type TargetingLineLite,
  broadcastableHours,
  screenhostMatchesTargeting,
  screenhostMatchesZones,
} from './eligibility.js';

// The pool's HARD FILTERS as ONE ordered list (pure). assemblePool keeps an active venue iff none
// fails, and journals the FIRST one that fails (LOG1's `venue_excluded`, which the admin « Hosts
// éligibles » view reads back). One function for both, so the filter and the reason it names can
// never disagree. Membership does not depend on the order; only the named reason does:
//
//   owner_not_approved — ELIG-2: no other property of the venue matters until its owner is
//                        validated (pending, rejected, banned or no owner at all);
//   no_installed_screen — MAP-TV1: nor until it has a TV that ever ran (lib/installed-screen.ts);
//   excluded           — the caller removed it (the cascade's refusers, redispatch's defaulters
//                        and dead screens);
//   not_in_frozen_week — TW-SNAP (ruled Q2 B): the campaign's typical week was frozen at cart add
//                        and this venue was not in it (it joined the network afterwards);
//   hours_missing      — the venue's own opening hours;
//   targeting_mismatch — category × class (E5.1: no line = the whole network);
//   zone_mismatch      — CF-Z1 (no zone on the campaign = the whole network).
//
// Inactive venues never reach this list: assemblePool reads active rows only and journals the
// inactive ones apart.
//
// CAP-EVT1 (operator ruling 2026-09-22) — `broadcast_capacity` is NOT a standard gate any more: it
// is the venue's EVENT-only eligibility switch. A standard campaign sells and places a venue
// whatever its capacity says, so 'capacity_missing' is no longer produced here. (The admin engine
// journal keeps its label: rows written before still carry it.)

export type PoolExclusionReason =
  | 'owner_not_approved'
  | 'no_installed_screen'
  | 'excluded'
  | 'not_in_frozen_week'
  | 'hours_missing'
  | 'targeting_mismatch'
  | 'zone_mismatch';

/** The columns of an active venue the filters read (ownerApproved = lib/approved-owner.ts,
 *  installedScreen = lib/installed-screen.ts — both selected as SQL booleans). */
export interface PoolVenueRow {
  id: string;
  ownerApproved: boolean;
  installedScreen: boolean;
  businessSectorId: string | null;
  class: string | null;
  zoneId: string | null;
  openingHour: number | null;
  closingHour: number | null;
}

/** What the campaign (and the caller) bring: targeting lines, targeted zones, excluded venues. */
export interface PoolFilterContext {
  lines: readonly TargetingLineLite[];
  zoneIds: readonly string[];
  excluded: ReadonlySet<string>;
  /** TW-SNAP — the venues of the campaign's frozen typical week; null = no freeze (live week). */
  frozenVenues?: ReadonlySet<string> | null;
}

/** The first hard filter the venue fails, or null when it is a pool candidate. */
export const poolExclusionReason = (
  sh: PoolVenueRow,
  ctx: PoolFilterContext,
): PoolExclusionReason | null => {
  if (!sh.ownerApproved) return 'owner_not_approved';
  if (!sh.installedScreen) return 'no_installed_screen';
  if (ctx.excluded.has(sh.id)) return 'excluded';
  if (ctx.frozenVenues && !ctx.frozenVenues.has(sh.id)) return 'not_in_frozen_week';
  if (broadcastableHours(sh.openingHour, sh.closingHour).length === 0) return 'hours_missing';
  const venue = { businessSectorId: sh.businessSectorId, class: sh.class };
  if (!screenhostMatchesTargeting(venue, ctx.lines)) return 'targeting_mismatch';
  if (!screenhostMatchesZones(sh.zoneId, ctx.zoneIds)) return 'zone_mismatch';
  return null;
};
