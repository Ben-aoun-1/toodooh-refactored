import { describe, expect, it } from 'vitest';

import { htTtcLabel } from '@/lib/money';

import { computeDashboardStats } from './dashboard-stats.transform';

// Fixed reference date so the current/previous-year bucketing is deterministic.
const NOW = new Date(2026, 4, 16);

describe('computeDashboardStats', () => {
  it('returns zeroed stats for an empty campaign list', () => {
    const result = computeDashboardStats([], 0, 0, NOW);

    expect(result.totalCreatedCampaignsCount).toBe(0);
    expect(result.stats.campaignsDiffused).toBe(0);
    expect(result.stats.activeCampaigns).toBe(0);
    expect(result.stats.totalViews).toBe(0);
    expect(result.stats.conversionRate).toBe(0);
  });

  it('buckets campaigns into current vs previous year', () => {
    const campaigns = [
      { status: 'active', views: 100, budget: 500, created_at: '2026-03-01' },
      { status: 'completed', views: 40, budget: 300, created_at: '2026-04-10' },
      { status: 'active', views: 50, budget: 200, created_at: '2025-06-01' },
    ];

    const result = computeDashboardStats(campaigns, 1000, 1000, NOW);

    expect(result.stats.campaignsDiffused).toBe(2);
    expect(result.stats.activeCampaigns).toBe(1);
    expect(result.stats.totalViews).toBe(140);
    expect(result.stats.totalBudget).toBe(800);
    expect(result.stats.totalDurationSeconds).toBe(140 * 30);
    expect(result.stats.prevYearCampaigns).toBe(1);
    expect(result.stats.prevYearViews).toBe(50);
    expect(result.stats.prevYearBudget).toBe(200);
    expect(result.totalCreatedCampaignsCount).toBe(3);
  });

  // FIX2 riders (the prod repro: « Campagnes diffusées » 13→14 and « Budget total alloué » +300
  // ON CART ADD): the tiles count REAL activity — a draft moves NEITHER, a pending/upcoming
  // campaign carries its CONFIRMED budget but is not « diffusée » yet.
  it('a DRAFT (cart add) moves neither tile; rejected campaigns move nothing either', () => {
    const result = computeDashboardStats(
      [
        { status: 'draft', views: 0, budget: 300, created_at: '2026-03-01' },
        { status: 'rejected', views: 0, budget: 250, created_at: '2026-03-02' },
      ],
      0,
      0,
      NOW,
    );

    expect(result.stats.campaignsDiffused).toBe(0);
    expect(result.stats.totalBudget).toBe(0);
    expect(result.totalCreatedCampaignsCount).toBe(2); // created ≠ diffused — the split the tiles now honor
  });

  it('pending/upcoming count their CONFIRMED budget but are not « diffusées » yet', () => {
    const result = computeDashboardStats(
      [
        { status: 'pending', views: 0, budget: 300, created_at: '2026-03-01' },
        { status: 'upcoming', views: 0, budget: 150, created_at: '2026-03-02' },
        { status: 'active', views: 20, budget: 500, created_at: '2026-03-03' },
      ],
      0,
      0,
      NOW,
    );

    expect(result.stats.campaignsDiffused).toBe(1); // only the active one aired
    expect(result.stats.totalBudget).toBe(950); // all three budgets are CONFIRMED money
  });

  it('treats a campaign with no created_at as current-year', () => {
    const result = computeDashboardStats([{ status: 'active', views: 10, budget: 0 }], 0, 0, NOW);

    expect(result.stats.campaignsDiffused).toBe(1);
    expect(result.stats.prevYearCampaigns).toBe(0);
  });

  it('FIX2 — spendable headlines « Solde disponible », total rides as « Solde total »', () => {
    const result = computeDashboardStats([], 370, 770, NOW);

    // The SHARED money lib is the one formatter (TVA lives there, nowhere else).
    expect(result.stats.balance).toBe(htTtcLabel(370));
    expect(result.stats.balanceTotal).toBe(htTtcLabel(770));
    expect(result.stats.balance).toMatch(/TND HT \(.+TND TTC\)$/);
    expect(result.availableBalanceTnd).toBe(370); // the getting-started gate reads SPENDABLE
  });

  it('rounds the conversion rate to one decimal place', () => {
    const campaigns = [
      { status: 'active', views: 3, budget: 0, created_at: '2026-02-01' },
      { status: 'paused', views: 0, budget: 0, created_at: '2026-02-01' },
    ];

    const result = computeDashboardStats(campaigns, 0, 0, NOW);

    // 1 active / 3 views * 100 = 33.333… → rounds to 33.3
    expect(result.stats.conversionRate).toBe(33.3);
  });
});
