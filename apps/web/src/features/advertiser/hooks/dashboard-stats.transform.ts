/**
 * Step 10 — pure transform extracted from `useDashboardStats`.
 *
 * The advertiser dashboard's year-bucketing math (current vs previous year
 * campaign aggregation, balance formatting) is pure: given campaign rows, a
 * balance, and a reference date it produces the same result every time. It
 * is extracted here so it can be unit-tested in the node test environment
 * without React or Supabase (D-T option A). `useDashboardStats` calls it
 * after fetching; the Supabase fetch itself stays in the hook's `queryFn`.
 *
 * No imports from `react`, `react-query`, or `supabase` — pure in / pure out.
 */

export interface DashboardStats {
  activeCampaigns: number;
  campaignsDiffused: number;
  totalViews: number;
  conversionRate: number;
  balance: string;
  totalBudget: number;
  totalDurationSeconds: number;
  prevYearCampaigns: number;
  prevYearViews: number;
  prevYearDurationSeconds: number;
  prevYearBudget: number;
}

export const INITIAL_STATS: DashboardStats = {
  activeCampaigns: 0,
  campaignsDiffused: 0,
  totalViews: 0,
  conversionRate: 0,
  balance: '0 TND',
  totalBudget: 0,
  totalDurationSeconds: 0,
  prevYearCampaigns: 0,
  prevYearViews: 0,
  prevYearDurationSeconds: 0,
  prevYearBudget: 0,
};

/** A campaign row as selected by `useDashboardStats` — only the fields the math reads. */
export interface DashboardStatsCampaignRow {
  status?: string | null;
  views?: number | null;
  budget?: number | string | null;
  created_at?: string | null;
}

export interface DashboardStatsResult {
  stats: DashboardStats;
  availableBalanceTnd: number;
  totalCreatedCampaignsCount: number;
}

const formatAmountFr = (amount: number) =>
  `${new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
    amount,
  )} TND`;

/**
 * Compute the advertiser dashboard stats. `now` is injectable so the
 * year-bucketing is deterministic under test; production callers omit it.
 */
export function computeDashboardStats(
  campaigns: DashboardStatsCampaignRow[],
  balance: number,
  now: Date = new Date(),
): DashboardStatsResult {
  const currentYearStart = new Date(now.getFullYear(), 0, 1);
  const prevYearStart = new Date(now.getFullYear() - 1, 0, 1);
  const prevYearEnd = new Date(now.getFullYear(), 0, 1);

  const isCurrentYear = (c: DashboardStatsCampaignRow) => {
    if (!c.created_at) return true;
    return new Date(c.created_at) >= currentYearStart;
  };
  const isPrevYear = (c: DashboardStatsCampaignRow) => {
    if (!c.created_at) return false;
    const d = new Date(c.created_at);
    return d >= prevYearStart && d < prevYearEnd;
  };

  const allCampaigns = campaigns || [];
  const currentCampaigns = allCampaigns.filter(isCurrentYear);
  const prevYearCampaignsList = allCampaigns.filter(isPrevYear);

  const campaignsDiffused = currentCampaigns.length;
  const activeCampaigns = currentCampaigns.filter((c) => c.status === 'active').length;
  const totalViews = currentCampaigns.reduce((sum, c) => sum + (c.views || 0), 0);
  const totalBudget = currentCampaigns.reduce(
    (sum, c) => sum + (parseFloat(String(c.budget)) || 0),
    0,
  );
  const totalDurationSeconds = totalViews * 30;

  const prevYearCampaigns = prevYearCampaignsList.length;
  const prevYearViews = prevYearCampaignsList.reduce((sum, c) => sum + (c.views || 0), 0);
  const prevYearBudget = prevYearCampaignsList.reduce(
    (sum, c) => sum + (parseFloat(String(c.budget)) || 0),
    0,
  );
  const prevYearDurationSeconds = prevYearViews * 30;

  const conversionRate = totalViews > 0 ? (activeCampaigns / totalViews) * 100 : 0;

  return {
    stats: {
      activeCampaigns,
      campaignsDiffused,
      totalViews,
      conversionRate: Math.round(conversionRate * 10) / 10,
      balance: formatAmountFr(balance),
      totalBudget,
      totalDurationSeconds,
      prevYearCampaigns,
      prevYearViews,
      prevYearDurationSeconds,
      prevYearBudget,
    },
    availableBalanceTnd: balance,
    totalCreatedCampaignsCount: allCampaigns.length,
  };
}
