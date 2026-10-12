/**
 * Feature flags (operator 2026-10-12, Q1 A: flags in code — flipping one is a one-line change
 * here plus a deploy). Each flag names what it turns ON; `false` hides/locks the feature as ruled.
 * The api carries the twins that govern its PDFs (apps/api/src/lib/feature-flags.ts) — flip both.
 */
export const FEATURE_FLAGS = {
  /** Campaign creation: every category is selected and cannot be unselected (« Tout le réseau »
   * forced on). Operator 2026-10-12. */
  campaignCategoriesLocked: true,
  /** Screenhost « Mes performances » + monthly PDF: « Vos peak hours » (was Section 02). */
  ownerPerfPeakHours: false,
  /** Screenhost « Mes performances » + monthly PDF: « Profil typologique » (was Section 04). */
  ownerPerfDemographics: false,
  /** The venue's CSP level (populaire / moyen / premium): the screenhost « Catégorie » suffix and
   * the screencaster's « niveau CSP » analysis + PDF (operator 2026-10-12, Q2 both). */
  cspLevel: false,
} as const;

export type FeatureFlag = keyof typeof FEATURE_FLAGS;
