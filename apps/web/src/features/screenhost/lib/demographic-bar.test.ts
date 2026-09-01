import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { demoBarPct } from './demographic-bar';

// MEJ-14a (Mejri, ruled through the operator 2026-09-01) — the S04 bars must be EMPTY while there
// is nothing to compute. The page and the PDF each carried their own copy of the mockup's
// decorative widths, which is how they came to agree on the wrong thing; this file enforces that
// there is now ONE copy, read from disk and compared byte for byte. (The ev1-pins technique.)
const readShared = (path: string): string => {
  const source = readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
  const start = source.indexOf('// ── shared block');
  const end = source.indexOf('// ── end shared block ──');
  if (start === -1 || end === -1) throw new Error(`shared block markers missing in ${path}`);
  return source.slice(start, end);
};

describe('the S04 bar rule is ONE rule', () => {
  it('the api copy and the web copy are byte-identical', () => {
    expect(readShared('./demographic-bar.ts')).toBe(
      readShared('../../../../../api/src/lib/report/demographic-bar.ts'),
    );
  });
});

describe('demoBarPct — pending draws the track only', () => {
  it('pending is 0 whatever the counts say', () => {
    expect(demoBarPct({ pending: true, count: 0, maxCount: 0 })).toBe(0);
    // The decorative widths the mockup drew (sexe 50/50, ages 32/28/14/6) are what this kills:
    // a count that WOULD fill the bar must still render empty while the figures are pending.
    expect(demoBarPct({ pending: true, count: 900, maxCount: 900 })).toBe(0);
  });

  it('no positive reference is 0 — a bar with no ratio behind it would be decoration again', () => {
    expect(demoBarPct({ pending: false, count: 0, maxCount: 0 })).toBe(0);
    expect(demoBarPct({ pending: false, count: 5, maxCount: -1 })).toBe(0);
  });

  it('real figures fill in proportion to the group maximum', () => {
    expect(demoBarPct({ pending: false, count: 900, maxCount: 900 })).toBe(100);
    expect(demoBarPct({ pending: false, count: 450, maxCount: 900 })).toBe(50);
    expect(demoBarPct({ pending: false, count: 0, maxCount: 900 })).toBe(0);
  });

  it('clamps rather than overflowing the track', () => {
    expect(demoBarPct({ pending: false, count: 1800, maxCount: 900 })).toBe(100);
    expect(demoBarPct({ pending: false, count: -50, maxCount: 900 })).toBe(0);
  });
});
