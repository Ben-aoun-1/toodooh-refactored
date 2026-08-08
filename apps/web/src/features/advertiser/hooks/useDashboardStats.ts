import { useQuery } from '@tanstack/react-query';

import { campaignsApi } from '@/features/campaigns/services/campaigns.api';
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
 * CF-HF3 (Mejri item 3) — the CAMPAIGN legs are live too: GET /api/campaigns/mine feeds the
 * views/budget/year buckets. CF-HF4 (Kais) — the advertiser dashboard is PRÉVUES-ONLY like every
 * cast surface: views = the frozen plan's planned impressions (0 until a plan exists — the
 * delivered numbers stay host-side). The old hardcoded empty list (the Supabase-era stub) is
 * retired. A campaigns-fetch error degrades to the empty list, mirroring the balance leg.
 */
async function fetchDashboardStats(): Promise<DashboardStatsResult> {
  let campaigns: DashboardStatsCampaignRow[] = [];
  try {
    campaigns = (await campaignsApi.mine()).map((c) => ({
      status: c.status,
      views: c.planned_impressions ?? 0,
      budget: c.requested_budget,
      created_at: c.created_at,
    }));
  } catch (e) {
    log.error({ error: e }, 'Erreur récupération campagnes (stats)');
  }

  // FIX2 — both solde figures come from the ONE api seam (spendable = the funded-gate figure).
  let spendableTnd = 0;
  let totalTnd = 0;
  try {
    const wallet = await walletService.getBalance();
    spendableTnd = wallet.spendable_tnd;
    totalTnd = wallet.balance_tnd;
  } catch (e) {
    log.error({ error: e }, 'Erreur récupération solde');
  }

  return computeDashboardStats(campaigns, spendableTnd, totalTnd);
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
