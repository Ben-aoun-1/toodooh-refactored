import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// CF-HF4 — source pins (no render harness): the permanent cart sidebar, the contained 16:9
// renders, the prévues-only cast rule (both directions), and the admin liveness chip.

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('the permanent cart sidebar', () => {
  const source = read('./components/CartWidget.tsx');

  it('is ALWAYS rendered — no count-0 or route bailout remains; the empty state speaks', () => {
    expect(source).not.toContain('return null');
    expect(source).toContain('Votre panier est vide.');
  });

  it('collapses without unmounting and stays consistent on the cart page itself', () => {
    expect(source).toContain('setCollapsed');
    expect(source).toContain("location.pathname === '/my-cart'"); // only the CTA adapts, not the mount
  });
});

describe('the contained 16:9 creative renders (both sites share the ONE tile)', () => {
  it('the tile CONTAINS media — no crop (object-cover) on either element', () => {
    const tile = read('../campaigns/pages/new-campaign/CreativePreviewTile.tsx');
    expect(tile).toContain('aspect-video');
    expect((tile.match(/object-contain/g) ?? []).length).toBe(2); // img + video
    expect(tile).not.toContain('object-cover');
  });

  it('the host acceptation viewer reuses that tile (one fix, two surfaces)', () => {
    expect(read('../screenhost/components/AllocationSpotViewer.tsx')).toContain(
      'CreativePreviewTile',
    );
  });
});

describe('prévues-only on the cast side; host untouched (both directions)', () => {
  it('the display lib and every cast consumer dropped validées', () => {
    for (const rel of [
      '../campaigns/lib/campaign-impressions.ts',
      '../campaigns/components/CampaignDrawer.tsx',
      '../campaigns/pages/MyCampaigns.tsx',
      '../advertiser/components/dashboard/LastCampaignsGrid.tsx',
      '../advertiser/hooks/useDashboardStats.ts',
    ]) {
      expect(read(rel), `${rel} still renders validées`).not.toMatch(
        /VALIDEES_LABEL|showValidees|validated_impressions/,
      );
    }
    expect(read('../advertiser/components/dashboard/StatsGrid.tsx')).toContain(
      'Impressions prévues',
    );
  });

  it('the HOST performance surface keeps its own delivered reads (untouched)', () => {
    const host = read('../screenhost/pages/OwnerPerformance.tsx');
    expect(host).toContain('impressions'); // the owner numbers live on
  });
});

describe('the admin liveness chip', () => {
  const source = read('../admin/components/ScreenhostLiveness.tsx');

  it('reuses the owner-calendar liveness vocabulary (the ONE threshold home)', () => {
    expect(source).toContain('device-liveness');
    expect(source).toContain('DEVICE_STATUS_LABELS');
    expect(source).toContain('deviceStatusOf');
  });

  it('renders « N écran(s) » + a chip per state, wired to the admin devices read', () => {
    expect(source).toContain('écran');
    expect(source).toContain('/devices');
    for (const state of ['connected', 'offline', 'never']) {
      expect(source).toContain(state);
    }
  });

  it('is mounted on the eligibility card', () => {
    expect(read('../admin/components/ScreenhostEligibilityCard.tsx')).toContain(
      'ScreenhostLiveness',
    );
  });
});
