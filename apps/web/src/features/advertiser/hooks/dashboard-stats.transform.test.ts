import { describe, expect, it } from 'vitest';

import { computeDashboardStats } from './dashboard-stats.transform';

// Fixed reference date so the current/previous-year bucketing is deterministic.
const NOW = new Date(2026, 4, 16);

describe('computeDashboardStats', () => {
  it('returns zeroed stats for an empty campaign list', () => {
    const result = computeDashboardStats([], 0, NOW);

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

    const result = computeDashboardStats(campaigns, 1000, NOW);

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

  it('treats a campaign with no created_at as current-year', () => {
    const result = computeDashboardStats([{ status: 'active', views: 10, budget: 0 }], 0, NOW);

    expect(result.stats.campaignsDiffused).toBe(1);
    expect(result.stats.prevYearCampaigns).toBe(0);
  });

  it('formats the balance as a fr-FR TND string and echoes the raw amount', () => {
    const result = computeDashboardStats([], 1234.5, NOW);

    expect(result.stats.balance).toMatch(/TND$/);
    expect(result.availableBalanceTnd).toBe(1234.5);
  });

  it('rounds the conversion rate to one decimal place', () => {
    const campaigns = [
      { status: 'active', views: 3, budget: 0, created_at: '2026-02-01' },
      { status: 'paused', views: 0, budget: 0, created_at: '2026-02-01' },
    ];

    const result = computeDashboardStats(campaigns, 0, NOW);

    // 1 active / 3 views * 100 = 33.333… → rounds to 33.3
    expect(result.stats.conversionRate).toBe(33.3);
  });
});
