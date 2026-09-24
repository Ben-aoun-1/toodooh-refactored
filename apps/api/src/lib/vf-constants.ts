// E1 — the VF business constants, one module, each mapped to its VF legend row. These are the
// CANONICAL spec values; the calibratable dispatch_config row may deviate operationally (its
// seeded POC values predate the VF), and later lanes reconcile the consumers one by one.
//
//   VF legend row                      → constant
//   « S_min = 20 TND »                 → S_MIN_TND — the refund-gate materiality floor: a campaign
//                                        whose valued shortfall (P_perte) is under this is settled
//                                        as RÉUSSIE (no refund). Consumed by reconcile (E1).
//   « seuil diffusable = 5 000 imp. »  → SEUIL_DIFFUSABLE — the anti-miette (no-crumbs) floor: no
//                                        screenhost allocation below this many impressions.
//                                        SUPERSEDED on the dispatch path (E3, Mariem 2026-07-15):
//                                        the seuil is now VALUE-based — seuilImpressions(cpm) =
//                                        S_MIN_TND × 1000 ÷ CPM (lib/dispatch/thresholds.ts), the
//                                        same rule as redispatch. Constant kept; removal banked.
//   « G_mois = 100 TND »               → G_MOIS_TND — the monthly screenhost dignity target.
//                                        Consumed by a later lane (E4 dignity).
//   « valeur min SH = 20 TND »         → VALEUR_MIN_SH_TND — the minimum TND value an allocation
//                                        must be worth to a screenhost. Consumed by a later lane.
//   « % SH = 50 % »                    → PCT_SH — the screenhost share of billed diffusion value.
//                                        Consumed by E7 (earnings split; the current
//                                        delivered × cpm/1000 formula is UNTOUCHED until then).

export const S_MIN_TND = 20;

/**
 * CAP-F1 (operator ruling 2026-09-24) — a screen's shared broadcast limit: the physical hour. F
 * (dispatch_config.f_max_seconds, 300 s) is each CAMPAIGN's own hourly cap on a screen, so up to
 * 3600 ÷ F campaigns at their full F may share one screen hour.
 */
export const SCREEN_SECONDS_PER_HOUR = 3600;
export const SEUIL_DIFFUSABLE = 5000;
export const G_MOIS_TND = 100;
export const VALEUR_MIN_SH_TND = 20;
export const PCT_SH = 0.5;
