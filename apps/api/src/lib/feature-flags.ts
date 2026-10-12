/**
 * Feature flags — the api twins of apps/web/src/lib/feature-flags.ts (operator 2026-10-12, Q1 A:
 * flags in code, flip = one line + deploy; flip BOTH files). Here they govern the screencaster's
 * campaign-report PDF, so the document never shows what the « Mes performances » page hides.
 * Screencaster only — the screenhost's page and report are untouched (operator 2026-10-12, B).
 */
export const FEATURE_FLAGS = {
  /** Screencaster performances + campaign PDF: « Répartition par catégorie de lieu » (Section 02). */
  screencasterPerfCategories: false,
  /** Screencaster performances + campaign PDF: « Répartition par zone géographique » (Section 04). */
  screencasterPerfZones: false,
  /** Screencaster performances + campaign PDF: the « niveau CSP » block of the audience section. */
  cspLevel: false,
} as const;
