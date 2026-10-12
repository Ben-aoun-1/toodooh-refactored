import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { FEATURE_FLAGS } from '@/lib/feature-flags';

import { audienceSectionCopy } from './performances-derive';

// Flag cspLevel (operator 2026-10-12, Q2 both) — off: the screencaster « Mes performances » drops
// the « niveau CSP » donut, its section title wording and the campaigns' « Classes » row.

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
