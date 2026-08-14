import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// CF-HF4 — source pins (no render harness): the permanent cart sidebar, the contained 16:9
// renders, the prévues-only cast rule (both directions), and the admin liveness chip.

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

// CART-V1 (operator ruling 2026-08-13) — the docked bar SUPERSEDES the CF-HF4 empty-state and
// GREEN2 collapse behaviours: ≥ 1 item → permanent right-edge bar, 0 → nothing docked. The
// CF-HF4 always-mounted permanence continues in the new form (CartWidget stays the one mount).
describe('the docked cart bar (CART-V1)', () => {
  const dispatcher = read('./components/CartWidget.tsx');
  const dockBar = read('./components/CartDockBar.tsx');
  const edgeTab = read('./components/CartEdgeTab.tsx');

  it('the ONE mount dispatches both forms — desktop docked bar + below-lg edge tab', () => {
    expect(dispatcher).toContain('<CartDockBar />');
    expect(dispatcher).toContain('<CartEdgeTab />');
  });

  it('both forms apply the SAME pure visibility rule (≥ 1 item docked, 0 → nothing)', () => {
    expect(dockBar).toContain('if (!cartBarVisible(count)) return null;');
    expect(edgeTab).toContain('if (!cartBarVisible(count)) return null;');
  });

  it('the desktop bar is IN-FLOW — no fixed/absolute positioning class in its markup (layout yields width by construction)', () => {
    expect(dockBar).not.toMatch(/className="[^"]*\b(fixed|absolute)\b/);
    expect(dockBar).toContain('hidden lg:flex'); // the lg gate — below it the edge tab takes over
    expect(edgeTab).toContain('lg:hidden'); // and the tab never doubles the bar at ≥ lg
  });

  it('the sidebar nav carries the PERMANENT « Mon panier » entry — reachable at zero items (CART-V1 amendment)', () => {
    const layout = read('../advertiser/components/AdvertiserLayout.tsx');
    expect(layout).toContain('path="/my-cart"');
    expect(layout).toContain('label="Mon panier"');
    // Unconditional: the entry sits in the static nav, never gated on the cart count.
    expect(layout).not.toContain('cartBarVisible');
  });

  it('the cart-page consistency survives — only the CTA adapts, never the mount', () => {
    expect(dockBar).toContain("location.pathname === '/my-cart'");
    expect(edgeTab).toContain("location.pathname === '/my-cart'");
    expect(dockBar).toContain('Voir mon panier');
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
