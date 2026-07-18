import { useQuery } from '@tanstack/react-query';

import { walletService } from '@/features/wallet/services/wallet.service';
import { logger } from '@/lib/logger';

import {
  computeDashboardStats,
  INITIAL_STATS,
  type DashboardStats,
  type DashboardStatsCampaignRow,
  type DashboardStatsResult,
} from './dashboard-stats.transform';
import { advertiserKeys } from './queryKeys';

const log = logger.child({ module: 'useDashboardStats' });

export type { DashboardStats };

interface UseDashboardStatsResult {
  stats: DashboardStats;
  availableBalanceTnd: number;
  totalCreatedCampaignsCount: number;
  loading: boolean;
  error: Error | null;
}

/**
 * CF-M1 — the BALANCE leg is live: GET /api/wallet/balance (the derived confirmed balance) feeds
 * `stats.balance` / `availableBalanceTnd`; a balance-fetch error is logged and treated as 0, as
 * before. Focus-refetch 'always' (per-query override, D-Q escape hatch): an admin confirms
 * recharges from another session, and the balance card must show the credit without a manual
 * refresh.
 *
 * The CAMPAIGN stats legs (views/budget/year buckets) were Supabase reads — disabled in prod (the
 * lazy client throws, so this whole query errored and every stat rendered 0). They now compute
 * over an EMPTY list: identical rendered output, no dead client. De-Supabase backlog: a live
 * source for views/budget aggregates (GET /api/campaigns/mine has requested_budget/status but no
 * views) — see #15.
 */
async function fetchDashboardStats(): Promise<DashboardStatsResult> {
  const campaigns: DashboardStatsCampaignRow[] = [];

  let balance = 0;
  try {
    balance = (await walletService.getBalance()).balance_tnd;
  } catch (e) {
    log.error({ error: e }, 'Erreur récupération solde');
    balance = 0;
  }

  return computeDashboardStats(campaigns, balance);
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
    error: query.error,
  };
}
