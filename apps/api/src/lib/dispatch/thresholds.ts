import { S_MIN_TND } from '../vf-constants.js';

// Dispatch thresholds (L-disp §2) — the three seuils and their RELATIONS, computed (never stored
// denormalized so they can't drift). G_mois/R_min_efficace/F are calibratable config; S_min and
// G_jour are DERIVED:
//   S_min  = seuil_diffusable × CPM ÷ 1000   (materiality floor, TND, per campaign)
//   G_jour = G_mois ÷ jours_actifs           (daily dignity target, TND, per screenhost)
// E3 (Mariem 2026-07-15 amendment) — on the DISPATCH path the derivation INVERTS: the anti-miette
// threshold is VALUE-based (the redispatch rule), seuil_impressions = S_min × 1000 ÷ CPM with
// S_min = S_MIN_TND. See seuilImpressions below.

/** S_min — the TND materiality floor for a campaign at the given CPM. */
export const computeSMin = (seuilDiffusable: number, cpm: number): number =>
  (seuilDiffusable * cpm) / 1000;

/**
 * E3 (Mariem 2026-07-15 amendment) — the VALUE-based anti-miette threshold, in FACTURABLE
 * impressions: the smallest integer allocation worth at least S_MIN_TND (20 TND) at the campaign's
 * CPM (≈1 334 at CPM 15; 667 at CPM 30). The ceil keeps the boundary honest — an allocation of
 * exactly the threshold is worth ≥ S_MIN_TND, one below it is not. This supersedes BOTH
 * dispatch_config.seuil_diffusable and the E1 SEUIL_DIFFUSABLE=5000 pin as the dispatch/cascade
 * seuil (they stay in place, no longer feeding this path; removal banked).
 */
export const seuilImpressions = (cpm: number): number => {
  if (cpm <= 0) throw new Error('seuilImpressions requires cpm > 0');
  return Math.ceil((S_MIN_TND * 1000) / cpm);
};

/** G_jour — the daily dignity target derived from the monthly target. */
export const computeGJour = (gMois: number, joursActifs: number): number =>
  joursActifs > 0 ? gMois / joursActifs : 0;

// V1 POC defaults (Grand Tunis) — calibratable, seeded into dispatch_config by migration 0026 and
// used as the fallback when no config row exists. F=300s is the spec's constant. standard/event CPM
// (TND/1000) are the operator ruling (15/30), admin-editable; columns added by migration 0033.
// E1 (VF) — t10s/t20s/t30s: the attention index T by spot-duration bucket (canonical
// 0,60/0,70/0,80; columns added by migration 0042, admin-editable within (0,1] and ordered).
export const DISPATCH_CONFIG_DEFAULTS = {
  // SUPERSEDED on the dispatch path (E3, Mariem 2026-07-15): the anti-miette seuil is now the
  // VALUE-based seuilImpressions(cpm) above. Kept for the admin config surface; removal banked.
  seuilDiffusable: 1000,
  gMois: 100,
  joursActifs: 30,
  rMinEfficace: 2,
  fMaxSeconds: 300,
  standardCpmTnd: 15,
  eventCpmTnd: 30,
  t10s: 0.6,
  t20s: 0.7,
  t30s: 0.8,
  // CF-D1 — the campaign start-date lead (working days; 0 = the floor is today, tests only).
  campaignLeadWorkingDays: 2,
  // E7 (VF EPIC 5) — the reversement split (Σ must be 100; the rail validates at every split).
  pctSh: 50,
  pctToodooh: 44,
  pctAgentSh: 3,
  pctAgentSc: 3,
} as const;

/**
 * E1 (VF) — the attention index T for a spot duration S (seconds): S ≤ 10 → t_10s, S ≤ 20 → t_20s,
 * else t_30s. S is capped at 30 upstream (CF-SH1's measured-duration rule), so the last bucket is
 * genuinely "21–30s". Photos use their chosen diffusion slot (10/20/30) — same buckets, the VF
 * prices them like equivalent videos. This T replaces the retired constant-1.0 "tier coefficient":
 * facturable capacity = Ai × Hi × R × T, and the planning back-conversion divides by the SAME T.
 */
export const tForDuration = (
  s: number,
  config: { t10s: number; t20s: number; t30s: number },
): number => {
  if (s <= 10) return config.t10s;
  if (s <= 20) return config.t20s;
  return config.t30s;
};
