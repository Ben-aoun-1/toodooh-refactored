// Eligible-pool primitives (Youssef's spec A.2 step 1 + A.5) — PURE. The DB assembly of the pool
// (fetching screenhosts/targeting/affluence and enriching into EligibleScreenhost[]) lives in the
// pipeline; these are the testable matching + capacity/repetition formulas.

export interface TargetingLineLite {
  categoryId: string | null; // null = "toutes les catégories"
  class: string | null; // null = "toutes les classes"
}

export interface ScreenhostLite {
  businessSectorId: string | null; // the venue's own category
  class: string | null; // the venue's tier
}

/**
 * Hard targeting filter (category × class). A screenhost matches the campaign if ANY targeting line
 * matches it: a NULL axis on the line = "toutes" (matches anything on that axis); the null/null line
 * = whole network (matches every screenhost). A screenhost whose own category/class is NULL only
 * matches lines that are "toutes" on that axis. No lines → nothing eligible (the caller validates
 * that a campaign has targeting before dispatch).
 */
export const screenhostMatchesTargeting = (
  sh: ScreenhostLite,
  lines: readonly TargetingLineLite[],
): boolean =>
  // E5.1 (VF US-2.1, canonical): an EMPTY targeting set = the whole network is targeted on this
  // criterion — every venue passes. This is THE single home of the empty-set semantics: pool
  // assembly, the cascade, redispatch and the coverage preview all read it from here, so the
  // wizard's « Tout le réseau » promise (toggle ON = the null/null line, toggle OFF / skip /
  // full deselect = zero lines) delivers identically on both wire shapes.
  lines.length === 0 ||
  lines.some(
    (line) =>
      (line.categoryId === null || line.categoryId === sh.businessSectorId) &&
      (line.class === null || line.class === sh.class),
  );

/**
 * The screenhost's broadcastable hours — the horaires window, WRAP INCLUDED since HOURS-X1
 * (08 → 01 = 17 hours). Lives in lib/opening-hours.ts; re-exported here for the engine importers.
 * Empty ⇒ horaires not set / zero-width ⇒ not eligible.
 */
export { broadcastableHours } from '../opening-hours.js';

/**
 * R = MIN[3600/S, F/S] — the PHYSICAL max reps/hour (floored to whole spots). E1 (VF): the
 * attention index T no longer scales R — physically, the same number of spots fits in an hour
 * regardless of attention; T discounts the FACTURABLE capacity below instead.
 */
export const computeR = (s: number, f: number): number => {
  if (s <= 0) return 0;
  return Math.floor(Math.min(3600 / s, f / s));
};

/** capacité brute = Ai·Hi·R — the SH's PHYSICAL potential impression capacity. */
export const capaciteUtile = (avgAffluence: number, hours: number, r: number): number =>
  avgAffluence * hours * r;

// ── E1 (VF) — the facturable ↔ physical conversion, ONE source for BOTH directions ──────────────
// Facturable capacity Ii = Ii_brut × T (the attention index discounts what a screen's physical
// capacity is WORTH to an advertiser); the planning back-conversion (US-2.9) divides the allocated
// FACTURABLE impressions by the SAME T to size the physical slots that must actually air. Keeping
// the two as adjacent inverses makes drift between the directions structurally impossible.

/** Ii = Ii_brut × T — physical capacity → facturable capacity. */
export const facturableFromPhysical = (physical: number, t: number): number => physical * t;

/** The inverse — allocated facturable impressions → the physical impressions to air. */
export const physicalFromFacturable = (facturable: number, t: number): number =>
  t > 0 ? facturable / t : 0;

/**
 * R_i = clamp(a_i / (Ai·Hi), R_min_efficace, R) — reps/hour planned at a screenhost (floored).
 * When R_min_efficace > R (a venue that can't reach the efficient floor), the clamp yields R.
 */
export const computeRi = (
  allocation: number,
  avgAffluence: number,
  hours: number,
  rMinEfficace: number,
  r: number,
): number => {
  const denom = avgAffluence * hours;
  if (denom <= 0) return Math.min(r, rMinEfficace);
  const raw = allocation / denom;
  return Math.floor(Math.min(r, Math.max(rMinEfficace, raw)));
};

/**
 * CF-Z1 (VF US-2.1) — the zone eligibility clause: a campaign WITH zones requires the venue's
 * zone to be among them; a campaign with NO zones passes everyone (whole network on this
 * criterion). A venue with no zone (NULL — pre-backfill or cleared) fails a zoned campaign.
 */
export function screenhostMatchesZones(
  venueZoneId: string | null,
  campaignZoneIds: readonly string[],
): boolean {
  if (campaignZoneIds.length === 0) return true;
  return venueZoneId !== null && campaignZoneIds.includes(venueZoneId);
}
