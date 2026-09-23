import { useQuery } from '@tanstack/react-query';

import { plannedPrevues } from '@/features/campaigns/lib/campaign-impressions';
import { campaignsApi } from '@/features/campaigns/services/campaigns.api';
import { walletService } from '@/features/wallet/services/wallet.service';

import {
  computeDashboardStats,
  INITIAL_STATS,
  type DashboardStats,
  type DashboardStatsCampaignRow,
  type DashboardStatsResult,
} from './dashboard-stats.transform';
import { advertiserKeys } from './queryKeys';

export type { DashboardStats };

interface UseDashboardStatsResult {
  stats: DashboardStats;
  availableBalanceTnd: number;
  totalCreatedCampaignsCount: number;
  loading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => void;
}

/**
 * CF-M1 — the BALANCE leg is live: GET /api/wallet/balance (the derived confirmed balance) feeds
 * `stats.balance` / `availableBalanceTnd`; a balance-fetch error is logged and treated as 0, as
 * before. Focus-refetch 'always' (per-query override, D-Q escape hatch): an admin confirms
 * recharges from another session, and the balance card must show the credit without a manual
 * refresh.
 *
 * CF-HF3 (Mejri item 3) — the CAMPAIGN legs are live too: GET /api/campaigns/mine feeds the
 * views/budget/year buckets. CF-HF4 (Kais) — the advertiser dashboard is PRÉVUES-ONLY like every
 * cast surface: views = the frozen plan's planned impressions (0 until a plan exists — the
 * delivered numbers stay host-side). The old hardcoded empty list (the Supabase-era stub) is
 * retired.
 *
 * IMP-UNIT1 (ruled B, 2026-09-22) — planned_impressions is now PHYSICAL (the real audience) on
 * both sides of dispatch, so this tile stopped shrinking by ~T when a campaign got dispatched.
 * KNOWN LIMIT, deliberate: the tile still counts only campaigns that HAVE a plan. A pre-dispatch
 * campaign contributes 0 here while its card shows IMP-EST1's dry-run estimate — a list endpoint
 * never fans dry-runs out (one pool assembly per row).
 *
 * GREEN2 (the INV-1 rule) — a FAILING leg now REJECTS the query instead of degrading to 0/[]:
 * zeros rendered as truth on infra failure were the same masquerade as the owner surfaces'
 * pre-first-data copy. The page renders the error state; React Query retries.
 */
export async function fetchDashboardStats(): Promise<DashboardStatsResult> {
  const campaigns: DashboardStatsCampaignRow[] = (await campaignsApi.mine()).map((c) => ({
    status: c.status,
    // IMP-FACT1 — the tile sums the dispatched campaigns' OBJECTIVES (the card's own figure).
    views: plannedPrevues(c) ?? 0,
    budget: c.requested_budget,
    created_at: c.created_at,
  }));

  // FIX2 — both solde figures come from the ONE api seam (spendable = the funded-gate figure).
  const wallet = await walletService.getBalance();
  return computeDashboardStats(campaigns, wallet.spendable_tnd, wallet.balance_tnd);
}

export function useDashboardStats(userId: string | undefined): UseDashboardStatsResult {
  const query = useQuery({
    queryKey: advertiserKeys.dashboardStats(userId ?? ''),
    queryFn: () => fetchDashboardStats(),
    enabled: !!userId,
    refetchOnWindowFocus: 'always',
  });

  return {
    stats: query.data?.stats ?? INITIAL_STATS,
    availableBalanceTnd: query.data?.availableBalanceTnd ?? 0,
    totalCreatedCampaignsCount: query.data?.totalCreatedCampaignsCount ?? 0,
    loading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: () => void query.refetch(),
  };
}
