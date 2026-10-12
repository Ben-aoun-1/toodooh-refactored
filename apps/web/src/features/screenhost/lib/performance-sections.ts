import { FEATURE_FLAGS } from '@/lib/feature-flags';

/**
 * The screenhost « Mes performances » sections, in order, and which ones the feature flags show
 * (operator 2026-10-12: « Vos peak hours » and « Profil typologique » hidden behind flags). The
 * visible ones are numbered 01, 02, 03… with no gap — the api's monthly PDF twin
 * (apps/api/src/lib/report/sections.ts) numbers the same way so page and document match.
 */
export const OWNER_PERF_SECTIONS = [
  'audience',
  'peakHours',
  'impressions',
  'demographics',
  'revenue',
  'campaigns',
  'optimisation',
  'sps',
] as const;

export type OwnerPerfSection = (typeof OWNER_PERF_SECTIONS)[number];

export interface OwnerPerfFlags {
  ownerPerfPeakHours: boolean;
  ownerPerfDemographics: boolean;
}

export const visibleOwnerSections = (flags: OwnerPerfFlags = FEATURE_FLAGS): OwnerPerfSection[] =>
  OWNER_PERF_SECTIONS.filter(
    (s) =>
      (s !== 'peakHours' || flags.ownerPerfPeakHours) &&
      (s !== 'demographics' || flags.ownerPerfDemographics),
  );

/** « Section 0N » for each VISIBLE section (a hidden one has no entry). */
export const ownerSectionNums = (
  flags: OwnerPerfFlags = FEATURE_FLAGS,
): Partial<Record<OwnerPerfSection, string>> =>
  Object.fromEntries(
    visibleOwnerSections(flags).map((s, i) => [s, `Section ${String(i + 1).padStart(2, '0')}`]),
  );
