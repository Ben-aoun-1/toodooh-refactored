import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getMock } = vi.hoisted(() => ({ getMock: vi.fn() }));
vi.mock('@/lib/api-client', () => ({ apiClient: { get: getMock } }));

import { revenueService } from './revenue.service';

// Pin "now" so the current-calendar-month filter is deterministic. Two lines reconciled in June
// 2026 (current month) + one in May 2026 (prior month).
const NOW = new Date('2026-06-28T12:00:00Z');
const EARNINGS = {
  total_tnd: 130.75,
  lines: [
    {
      campaign_id: 'camp-1',
      campaign_name: 'Campagne Été',
      screenhost_id: 'sh-A',
      screenhost_name: 'Café A',
      expected_imp: 10000,
      delivered_imp: 8000,
      earnings_tnd: 80.5,
      reconciled_at: '2026-06-20T10:00:00Z', // current month
    },
    {
      campaign_id: 'camp-2',
      campaign_name: 'Campagne Hiver',
      screenhost_id: 'sh-A',
      screenhost_name: 'Café A',
      expected_imp: 4000,
      delivered_imp: 4000,
      earnings_tnd: 40,
      reconciled_at: '2026-05-10T10:00:00Z', // prior month
    },
    {
      campaign_id: 'camp-1',
      campaign_name: 'Campagne Été',
      screenhost_id: 'sh-B',
      screenhost_name: 'Café B',
      expected_imp: 2000,
      delivered_imp: 2000,
      earnings_tnd: 10.25,
      reconciled_at: '2026-06-25T10:00:00Z', // current month
    },
  ],
};

describe('revenueService (engine-backed, de-Supabased)', () => {
  beforeEach(() => {
    getMock.mockReset();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('getRevenueStats GETs /screenhosts/earnings', async () => {
    getMock.mockResolvedValue(EARNINGS);
    await revenueService.getRevenueStats();
    expect(getMock).toHaveBeenCalledWith('/screenhosts/earnings');
  });

  it('getRevenueStats maps total + current-month sum + distinct screens + top performer', async () => {
    getMock.mockResolvedValue(EARNINGS);
    const stats = await revenueService.getRevenueStats();
    expect(stats.totalRevenue).toBe(130.75); // server total, passed through
    expect(stats.monthlyRevenue).toBeCloseTo(90.75, 4); // 80.5 (Jun) + 10.25 (Jun), NOT 40 (May)
    expect(stats.activeScreens).toBe(2); // sh-A + sh-B
    expect(stats.totalScreens).toBe(2);
    expect(stats.topPerformingScreen).toBe('Café A'); // 80.5 + 40 = 120.5 > 10.25
    // Honest zeros — these were Math.random() mocks with no real source.
    expect(stats.quarterlyRevenue).toBe(0);
    expect(stats.yearlyRevenue).toBe(0);
    expect(stats.growthRate).toBe(0);
    expect(stats.loyaltyPoints).toBe(0);
  });

  it('getRevenueStats returns honest zeros + empty top when nothing reconciled', async () => {
    getMock.mockResolvedValue({ total_tnd: 0, lines: [] });
    const stats = await revenueService.getRevenueStats();
    expect(stats).toMatchObject({
      totalRevenue: 0,
      monthlyRevenue: 0,
      activeScreens: 0,
      totalScreens: 0,
      averagePerScreen: 0,
      topPerformingScreen: '',
    });
  });

  it('getRevenueByPeriod yields one RevenueData per line (id, amount, date, campaign label)', async () => {
    getMock.mockResolvedValue(EARNINGS);
    const rows = await revenueService.getRevenueByPeriod('monthly');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      id: 'camp-1-sh-A',
      screen_id: 'sh-A',
      screen_name: 'Campagne Été', // campaign name surfaced as the label
      amount: 80.5,
      period: 'monthly',
      date: '2026-06-20T10:00:00Z',
    });
    // Earnings are positive credits — never negative debits.
    expect(rows.every((r) => r.amount >= 0)).toBe(true);
  });

  it('getRevenueByScreen folds lines per screenhost with summed totals', async () => {
    getMock.mockResolvedValue(EARNINGS);
    const screens = await revenueService.getRevenueByScreen();
    expect(screens).toHaveLength(2);
    const a = screens.find((s) => s.screen_id === 'sh-A');
    expect(a?.total_revenue).toBeCloseTo(120.5, 4); // 80.5 + 40
    expect(a?.revenue_history).toHaveLength(2);
  });

  it('getMonthlyComparison returns [] (no real source — not fabricated)', async () => {
    await expect(revenueService.getMonthlyComparison()).resolves.toEqual([]);
  });
});
