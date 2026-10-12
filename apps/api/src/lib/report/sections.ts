import { FEATURE_FLAGS } from '../feature-flags.js';

/**
 * The screenhost report's sections, in order, and the « Section 0N » label of each VISIBLE one
 * (flags hide « Vos peak hours » and « Profil typologique », operator 2026-10-12). Twin of
 * apps/web/src/features/screenhost/lib/performance-sections.ts — page and PDF number alike.
 */
export const REPORT_SECTIONS = [
  'audience',
  'peakHours',
  'impressions',
  'demographics',
  'revenue',
  'campaigns',
  'optimisation',
  'sps',
] as const;

export type ReportSection = (typeof REPORT_SECTIONS)[number];

export interface ReportSectionFlags {
  ownerPerfPeakHours: boolean;
  ownerPerfDemographics: boolean;
}

export const reportSectionNums = (
  flags: ReportSectionFlags = FEATURE_FLAGS,
): Partial<Record<ReportSection, string>> =>
  Object.fromEntries(
    REPORT_SECTIONS.filter(
      (s) =>
        (s !== 'peakHours' || flags.ownerPerfPeakHours) &&
        (s !== 'demographics' || flags.ownerPerfDemographics),
    ).map((s, i) => [s, `Section ${String(i + 1).padStart(2, '0')}`]),
  );
