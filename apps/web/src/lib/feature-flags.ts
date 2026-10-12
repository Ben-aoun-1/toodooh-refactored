/**
 * Feature flags (operator 2026-10-12, Q1 A: flags in code — flipping one is a one-line change
 * here plus a deploy). Each flag names what it turns ON; `false` hides/locks the feature as ruled.
 * The api carries the twins that govern the screencaster's campaign-report PDF
 * (apps/api/src/lib/feature-flags.ts) — flip both. The display flags are SCREENCASTER only: the
 * screenhost's « Mes performances » and report are untouched (operator 2026-10-12, B).
 */
export const FEATURE_FLAGS = {
  /** Campaign creation: every category is selected and cannot be unselected (« Tout le réseau »
   * forced on). */
  campaignCategoriesLocked: true,
  /** Screencaster « Mes performances » + campaign PDF: « Répartition par catégorie de lieu »
   * (Section 02). */
  screencasterPerfCategories: false,
  /** Screencaster « Mes performances » + campaign PDF: « Répartition par zone géographique »
   * (Section 04). */
  screencasterPerfZones: false,
  /** Screencaster « Mes performances » + campaign PDF: the « niveau CSP » donut / block and the
   * campaigns' « Classes » row. */
  cspLevel: false,
} as const;

export type FeatureFlag = keyof typeof FEATURE_FLAGS;
