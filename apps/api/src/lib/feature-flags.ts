/**
 * Feature flags — the api twins of apps/web/src/lib/feature-flags.ts (operator 2026-10-12, Q1 A:
 * flags in code, flip = one line + deploy; flip BOTH files). Here they govern the documents the
 * api renders, so a PDF never shows what the page hides.
 */
export const FEATURE_FLAGS = {
  /** Screenhost monthly / period PDF: « Vos peak hours » (was Section 02). */
  ownerPerfPeakHours: false,
  /** Screenhost monthly / period PDF: « Profil typologique » (was Section 04). */
  ownerPerfDemographics: false,
  /** The venue's CSP level: the screenhost report's « Catégorie » suffix and the screencaster
   * campaign report's « niveau CSP » block. */
  cspLevel: false,
} as const;
