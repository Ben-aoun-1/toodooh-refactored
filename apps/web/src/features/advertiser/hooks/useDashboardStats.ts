import { useQuery } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';

import {
  computeDashboardStats,
  INITIAL_STATS,
  type DashboardStats,
  type DashboardStatsResult,
} from './dashboard-stats.transform';
import { advertiserKeys } from './queryKeys';

export type { DashboardStats };

/** Only the engine campaign fields the dashboard math reads. */
interface CampaignView {
  status: string;
  requested_budget: number | null;
  created_at: string;
}

/** Engine derived wallet balance (`GET /api/wallet/balance`). */
interface WalletBalanceView {
  balance_tnd: number;
}

interface UseDashboardStatsResult {
  stats: DashboardStats;
  availableBalanceTnd: number;
  totalCreatedCampaignsCount: number;
  loading: boolean;
  error: Error | null;
}

/**
 * Fetches the engine campaigns (`GET /api/campaigns/mine`) + the derived wallet
 * balance (`GET /api/wallet/balance`) and runs the pure `computeDashboardStats`
 * transform — replacing the Supabase campaigns read + balance.service.
 *
 * FLAG — DELIVERED IMPRESSIONS come from reconciliation and have no advertiser
 * read API, so `views` is fed as 0. The transform's impression / diffusion-
 * duration / conversion outputs are therefore zeroed; the dashboard OMITS those
 * cards (StatsGrid) rather than fabricating performance. `budget` maps to the
 * indicative requested budget — the only campaign-budget field the engine
 * exposes. Campaign counts (diffused / active) and balance are faithful.
 */
async function fetchDashboardStats(): Promise<DashboardStatsResult> {
  const [campaigns, balance] = await Promise.all([
    apiClient.get<CampaignView[]>('/campaigns/mine'),
    apiClient.get<WalletBalanceView>('/wallet/balance'),
  ]);

  const rows = campaigns.map((c) => ({
    status: c.status,
    views: 0,
    budget: c.requested_budget ?? 0,
    created_at: c.created_at,
  }));

  return computeDashboardStats(rows, balance.balance_tnd);
}

export function useDashboardStats(userId: string | undefined): UseDashboardStatsResult {
  const query = useQuery({
    queryKey: advertiserKeys.dashboardStats(userId ?? ''),
    queryFn: fetchDashboardStats,
    enabled: !!userId,
  });

  return {
    stats: query.data?.stats ?? INITIAL_STATS,
    availableBalanceTnd: query.data?.availableBalanceTnd ?? 0,
    totalCreatedCampaignsCount: query.data?.totalCreatedCampaignsCount ?? 0,
    loading: query.isLoading,
    error: query.error,
  };
}
