import { useQuery } from '@tanstack/react-query';

import { platformStatsService } from '@/features/admin/services/platform-stats.service';

import { adminKeys } from './queryKeys';

/**
 * AdminDashboard's platform-stats composite — a `Promise.all` of the five
 * `platformStatsService` reads, behind one query key. Read-only.
 */
export function usePlatformStats() {
  const query = useQuery({
    queryKey: adminKeys.platformStats(),
    // Phase-1g tail: fail fast. These five reads still hit the dead Supabase backend (the admin
    // platform-stats slice is unbuilt) — the global retry:1 + ~1s backoff made the admin landing
    // spin ~1-2s before the content rendered. retry:false errors on the first attempt so the shell
    // (which already paints) is joined by the null-guarded empty stats (0/dashes) near-instantly.
    // Per-hook retry behavior gets re-evaluated when this slice repoints onto apps/api.
    retry: false,
    queryFn: async () => {
      const [global, revenue, occupancy, campaigns, top] = await Promise.all([
        platformStatsService.getGlobalStats(),
        platformStatsService.getRevenueStats(),
        platformStatsService.getOccupancyStats(),
        platformStatsService.getCampaignsPerformance(),
        platformStatsService.getTopScreens(5),
      ]);
      return { global, revenue, occupancy, campaigns, top };
    },
  });
  return { data: query.data, loading: query.isLoading, isError: query.isError };
}
