import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// CF-HF3 (Mejri item 2) — the Consulter render matrix, source-pinned (no render harness): the
// drawer previews BOTH creative types via the wizard tile, the zones fall back to « Tout le
// réseau » (never a bare « — »), and MyCampaigns feeds the drawer LIVE data (the dead
// video={undefined} + hardcoded selected_zones: [] era is over).

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('the Consulter drawer (CampaignDrawer)', () => {
  const source = read('../components/CampaignDrawer.tsx');

  it('previews the spot through the type-aware wizard tile (image AND video)', () => {
    expect(source).toContain('CreativePreviewTile');
    expect(source).toContain('creativeType={creative.creativeType}');
  });

  it('renders « Tout le réseau » when no zone is selected (an empty selection IS a targeting)', () => {
    expect(source).toContain("['Tout le réseau']");
  });

  it('renders the labeled per-status impressions (prévues + validées)', () => {
    expect(source).toContain('PREVUES_LABEL');
    expect(source).toContain('VALIDEES_LABEL');
    expect(source).toContain('impressions?.showValidees');
  });
});

describe('MyCampaigns feeds the drawer live data', () => {
  const source = read('../pages/MyCampaigns.tsx');

  it('the dead video={undefined} legacy prop is retired for the advertiser variant', () => {
    expect(source).not.toContain('video={undefined}');
    expect(source).toContain('useCreativePreviewUrl');
  });

  it('the rows carry the REAL wire zone names (the hardcoded empty selected_zones is dead)', () => {
    const hook = read('../hooks/useMyCampaigns.ts');
    expect(hook).toContain('selected_zones: (c.zones ?? []).map((z) => z.name)');
    expect(hook).not.toContain('selected_zones: []');
  });
});
