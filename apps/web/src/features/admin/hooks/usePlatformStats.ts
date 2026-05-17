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
