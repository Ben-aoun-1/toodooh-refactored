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

// CF-U1 (Mejri item 6) — the balance card montant carries its TTC like every advertiser montant;
// the formatter (and the 19% rate) live in the shared money lib (still pure).
import { htTtcLabel } from '@/lib/money';

export interface DashboardStats {
  activeCampaigns: number;
  campaignsDiffused: number;
  totalViews: number;
  conversionRate: number;
  /** FIX2 — the « Solde disponible » headline: SPENDABLE (what the funded gates enforce). */
  balance: string;
  /** FIX2 — « Solde total » (credits − net settlements ± adjustments), shown alongside. */
  balanceTotal: string;
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
  balance: '0 TND HT (0 TND TTC)',
  balanceTotal: '0 TND HT (0 TND TTC)',
  totalBudget: 0,
  totalDurationSeconds: 0,
  prevYearCampaigns: 0,
  prevYearViews: 0,
  prevYearDurationSeconds: 0,
  prevYearBudget: 0,
};

/** FIX2 rider — « Campagnes diffusées » counts campaigns that actually AIRED (or are airing). */
const DIFFUSED_STATUSES = new Set(['active', 'completed']);
/** FIX2 rider — « Budget total alloué » sums CONFIRMED budgets (drafts/rejected move nothing). */
const CONFIRMED_STATUSES = new Set(['pending', 'upcoming', 'active', 'completed']);

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

/**
 * Compute the advertiser dashboard stats. `now` is injectable so the
 * year-bucketing is deterministic under test; production callers omit it.
 * FIX2 — takes BOTH solde figures: spendable headlines « Solde disponible »
 * (the funded-gate figure), total rides beneath as « Solde total ».
 */
export function computeDashboardStats(
  campaigns: DashboardStatsCampaignRow[],
  spendableTnd: number,
  totalTnd: number,
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

  // FIX2 riders — the tiles count REAL activity, never intent: « Campagnes diffusées » = aired
  // (active/completed) only; « Budget total alloué » = CONFIRMED budgets only. A cart add (a
  // draft) moves NEITHER tile. Same rules on the previous-year comparison set.
  const campaignsDiffused = currentCampaigns.filter((c) =>
    DIFFUSED_STATUSES.has(c.status ?? ''),
  ).length;
  const activeCampaigns = currentCampaigns.filter((c) => c.status === 'active').length;
  const totalViews = currentCampaigns.reduce((sum, c) => sum + (c.views || 0), 0);
  const totalBudget = currentCampaigns.reduce(
    (sum, c) =>
      CONFIRMED_STATUSES.has(c.status ?? '') ? sum + (parseFloat(String(c.budget)) || 0) : sum,
    0,
  );
  const totalDurationSeconds = totalViews * 30;

  const prevYearCampaigns = prevYearCampaignsList.filter((c) =>
    DIFFUSED_STATUSES.has(c.status ?? ''),
  ).length;
  const prevYearViews = prevYearCampaignsList.reduce((sum, c) => sum + (c.views || 0), 0);
  const prevYearBudget = prevYearCampaignsList.reduce(
    (sum, c) =>
      CONFIRMED_STATUSES.has(c.status ?? '') ? sum + (parseFloat(String(c.budget)) || 0) : sum,
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
      balance: htTtcLabel(spendableTnd),
      balanceTotal: htTtcLabel(totalTnd),
      totalBudget,
      totalDurationSeconds,
      prevYearCampaigns,
      prevYearViews,
      prevYearDurationSeconds,
      prevYearBudget,
    },
    availableBalanceTnd: spendableTnd,
    totalCreatedCampaignsCount: allCampaigns.length,
  };
}
