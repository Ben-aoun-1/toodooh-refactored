// Dispatch thresholds (L-disp §2) — the three seuils and their RELATIONS, computed (never stored
// denormalized so they can't drift). seuil_diffusable/G_mois/R_min_efficace/F are calibratable
// config; S_min and G_jour are DERIVED:
//   S_min  = seuil_diffusable × CPM ÷ 1000   (materiality floor, TND, per campaign)
//   G_jour = G_mois ÷ jours_actifs           (daily dignity target, TND, per screenhost)

/** S_min — the TND materiality floor for a campaign at the given CPM. */
export const computeSMin = (seuilDiffusable: number, cpm: number): number =>
  (seuilDiffusable * cpm) / 1000;

/** G_jour — the daily dignity target derived from the monthly target. */
export const computeGJour = (gMois: number, joursActifs: number): number =>
  joursActifs > 0 ? gMois / joursActifs : 0;

// V1 POC defaults (Grand Tunis) — calibratable, seeded into dispatch_config by migration 0026 and
// used as the fallback when no config row exists. F=300s is the spec's constant. standard/event CPM
// (TND/1000) are the operator ruling (15/30), admin-editable; columns added by migration 0033.
// E1 (VF) — t10s/t20s/t30s: the attention index T by spot-duration bucket (canonical
// 0,60/0,70/0,80; columns added by migration 0042, admin-editable within (0,1] and ordered).
export const DISPATCH_CONFIG_DEFAULTS = {
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
