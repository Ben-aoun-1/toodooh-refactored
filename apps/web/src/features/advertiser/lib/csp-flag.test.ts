import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { FEATURE_FLAGS } from '@/lib/feature-flags';

import { audienceSectionCopy, screencasterSectionNums } from './performances-derive';

// Operator 2026-10-12 (B) — screencaster « Mes performances » only: « Répartition par catégorie de
// lieu » (02) and « Répartition par zone géographique » (04) hidden, the « niveau CSP » donut and
// the campaigns' « Classes » row too; the remaining sections number 01–02. The screenhost's page
// and report are untouched.

describe('the screencaster CSP level under the flag', () => {
  it('ships OFF: the section is « Profil de l’audience », its lead never names a gamme', () => {
    expect(FEATURE_FLAGS.cspLevel).toBe(false);
    const copy = audienceSectionCopy(FEATURE_FLAGS.cspLevel);
    expect(copy.title).toBe("Profil de l'audience");
    expect(copy.lead).not.toContain('gamme');
    expect(audienceSectionCopy(true).title).toBe("Profil de l'audience et niveau CSP");
  });

  it('the donut and the « Classes » row render only under the flag', () => {
    const src = readFileSync(
      join(__dirname, '..', 'components', 'performances', 'AnalysisSections.tsx'),
      'utf8',
    );
    expect(src).toContain('{FEATURE_FLAGS.cspLevel && (');
    expect(src.match(/FEATURE_FLAGS\.cspLevel && \(/g)).toHaveLength(2);
  });
});

describe('the screencaster sections under the flags', () => {
  it('ships with categories and zones OFF, numbered without a gap', () => {
    expect(FEATURE_FLAGS.screencasterPerfCategories).toBe(false);
    expect(FEATURE_FLAGS.screencasterPerfZones).toBe(false);
    expect(screencasterSectionNums(FEATURE_FLAGS)).toEqual({
      overview: 'Section 01',
      audience: 'Section 02',
    });
    expect(
      screencasterSectionNums({ screencasterPerfCategories: true, screencasterPerfZones: true }),
    ).toEqual({
      overview: 'Section 01',
      categories: 'Section 02',
      audience: 'Section 03',
      zones: 'Section 04',
    });
  });

  it('the page renders sections 02 and 04 only when numbered', () => {
    const src = readFileSync(
      join(__dirname, '..', 'components', 'performances', 'AnalysisSections.tsx'),
      'utf8',
    );
    expect(src).toContain('{nums.categories && (');
    expect(src).toContain('{nums.zones && (');
  });
});
