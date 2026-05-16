import { useQuery } from '@tanstack/react-query';

import { logger } from '@/lib/logger';
import { supabase } from '@/lib/supabase';
import { balanceService } from '@/services/balance.service';

import {
  computeDashboardStats,
  INITIAL_STATS,
  type DashboardStats,
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
 * Fetches the campaign rows + wallet balance and runs the pure
 * `computeDashboardStats` transform. A campaign-fetch error is logged and
 * treated as an empty list; a balance-fetch error is logged and treated as
 * 0 — both mirror the pre-React-Query behavior. Only a genuinely unexpected
 * throw propagates to `query.error`.
 */
async function fetchDashboardStats(userId: string): Promise<DashboardStatsResult> {
  const { data: campaigns, error: campaignsError } = await supabase
    .from('campaigns')
    .select('status, views, budget, created_at')
    .eq('user_id', userId);

  if (campaignsError) {
    log.error({ campaignsError }, 'Error fetching campaigns');
  }

  let balance = 0;
  try {
    const balanceInfo = await balanceService.getBalanceInfo(userId);
    balance = balanceInfo
      ? balanceInfo.available_balance
      : await balanceService.getUserBalance(userId);
  } catch (e) {
    log.error({ error: e }, 'Erreur récupération solde');
    balance = 0;
  }

  return computeDashboardStats(campaigns || [], balance);
}

export function useDashboardStats(userId: string | undefined): UseDashboardStatsResult {
  const query = useQuery({
    queryKey: advertiserKeys.dashboardStats(userId ?? ''),
    queryFn: () => fetchDashboardStats(userId as string),
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
