import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { FEATURE_FLAGS } from '@/lib/feature-flags';

import { ownerSectionNums, visibleOwnerSections } from './performance-sections';

// Operator 2026-10-12 — « Mes performances » (screenhost): « Vos peak hours » and « Profil
// typologique » hidden behind flags, the CSP level too; the visible sections number without a gap
// (the api's monthly PDF twin, lib/report/sections.ts, numbers the same).

describe('screenhost performance sections under the flags', () => {
  it('ships with peak hours, demographics and the CSP level OFF', () => {
    expect(FEATURE_FLAGS.ownerPerfPeakHours).toBe(false);
    expect(FEATURE_FLAGS.ownerPerfDemographics).toBe(false);
    expect(FEATURE_FLAGS.cspLevel).toBe(false);
  });

  it('hides the two sections and renumbers 01…06', () => {
    expect(visibleOwnerSections()).toEqual([
      'audience',
      'impressions',
      'revenue',
      'campaigns',
      'optimisation',
      'sps',
    ]);
    expect(ownerSectionNums()).toMatchObject({
      audience: 'Section 01',
      impressions: 'Section 02',
      sps: 'Section 06',
    });
    expect(ownerSectionNums().peakHours).toBeUndefined();
    expect(ownerSectionNums().demographics).toBeUndefined();
  });

  it('with the flags on, all eight come back in their original numbering', () => {
    const all = ownerSectionNums({ ownerPerfPeakHours: true, ownerPerfDemographics: true });
    expect(all.peakHours).toBe('Section 02');
    expect(all.demographics).toBe('Section 04');
    expect(all.sps).toBe('Section 08');
  });

  it('the page renders the two sections only when numbered, and drops the CSP suffix by flag', () => {
    const page = readFileSync(join(__dirname, '..', 'pages', 'OwnerPerformance.tsx'), 'utf8');
    expect(page).toContain('{nums.peakHours && (');
    expect(page).toContain('{nums.demographics && (');
    expect(page).toContain('FEATURE_FLAGS.cspLevel ? (profile.data?.class ?? null) : null');
  });
});
