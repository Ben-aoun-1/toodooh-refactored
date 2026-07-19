import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// CF-U2 — the ONE page-header idiom (PageHeader: text-xl font-semibold #171717 title +
// text-sm #5C5C5C subtitle, NO icon). Representative-page pins: each page delegates its h1 to
// PageHeader (no local h1 left), so a drifting one-off header fails here, not in review.

const SRC = join(__dirname, '..');
const pageSource = (rel: string): string => readFileSync(join(SRC, rel), 'utf8');

const REPRESENTATIVE_PAGES = [
  'features/screenhost/pages/OwnerScreens.tsx',
  'features/screenhost/pages/OwnerPerformance.tsx',
  'features/campaigns/pages/MyCampaigns.tsx',
];

describe('PageHeader — the harmonized header idiom', () => {
  it('the component pins the idiom classes (title + subtitle, no icon slot)', () => {
    const src = pageSource('components/PageHeader.tsx');
    expect(src).toContain('text-xl font-semibold text-[#171717]');
    expect(src).toContain('text-sm text-[#5C5C5C]');
    expect(src).not.toMatch(/LucideIcon|icon:/); // the idiom has NO icon — all-or-none, ruled none
  });

  for (const page of REPRESENTATIVE_PAGES) {
    it(`${page.split('/').pop()} delegates its header to PageHeader (no local h1)`, () => {
      const src = pageSource(page);
      expect(src).toContain('<PageHeader');
      expect(src).not.toContain('<h1'); // the h1 lives in PageHeader, one home
    });
  }

  it('Mes performances dropped its header icon tile (the outlier is aligned)', () => {
    const src = pageSource('features/screenhost/pages/OwnerPerformance.tsx');
    expect(src).not.toContain('bg-perf-lavender text-brand-accent'); // the retired header tile
  });
});
