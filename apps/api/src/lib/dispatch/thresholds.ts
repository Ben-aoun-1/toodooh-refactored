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
// used as the fallback when no config row exists. F=300s is the spec's constant.
export const DISPATCH_CONFIG_DEFAULTS = {
  seuilDiffusable: 1000,
  gMois: 100,
  joursActifs: 30,
  rMinEfficace: 2,
  fMaxSeconds: 300,
} as const;
