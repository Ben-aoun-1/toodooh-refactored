import { describe, expect, it, vi } from 'vitest';

vi.mock('@/features/campaigns/services/campaigns.api', () => ({
  campaignsApi: { mine: vi.fn() },
}));
vi.mock('@/features/wallet/services/wallet.service', () => ({
  walletService: { getBalance: vi.fn() },
}));

import { campaignsApi } from '@/features/campaigns/services/campaigns.api';
import { walletService } from '@/features/wallet/services/wallet.service';

import { fetchDashboardStats } from './useDashboardStats';

// GREEN2 (the INV-1 rule) — the dashboard fetch REJECTS on a failing leg instead of degrading to
// 0/[] rendered as truth. The page's error state (not INITIAL_STATS) is what a failure shows.
describe('fetchDashboardStats — no catch-to-empty', () => {
  it('a failing campaigns leg REJECTS (never an empty list passed off as data)', async () => {
    vi.mocked(campaignsApi.mine).mockRejectedValue(new Error('campaigns leg down'));
    vi.mocked(walletService.getBalance).mockResolvedValue({
      balance_tnd: 100,
      credited_tnd: 100,
      debited_tnd: 0,
      adjustments_tnd: 0,
      engaged_tnd: 0,
      spendable_tnd: 100,
      currency: 'TND',
    });
    await expect(fetchDashboardStats()).rejects.toThrow('campaigns leg down');
  });

  it('a failing balance leg REJECTS (never zeros passed off as the solde)', async () => {
    vi.mocked(campaignsApi.mine).mockResolvedValue([]);
    vi.mocked(walletService.getBalance).mockRejectedValue(new Error('balance leg down'));
    await expect(fetchDashboardStats()).rejects.toThrow('balance leg down');
  });

  it('both legs healthy → the computed result carries both solde figures', async () => {
    vi.mocked(campaignsApi.mine).mockResolvedValue([]);
    vi.mocked(walletService.getBalance).mockResolvedValue({
      balance_tnd: 770,
      credited_tnd: 1000,
      debited_tnd: 180,
      adjustments_tnd: -50,
      engaged_tnd: 400,
      spendable_tnd: 370,
      currency: 'TND',
    });
    const result = await fetchDashboardStats();
    expect(result.availableBalanceTnd).toBe(370);
    expect(result.stats.balanceTotal).toContain('770');
  });
});
