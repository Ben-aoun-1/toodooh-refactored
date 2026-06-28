import { useQuery } from '@tanstack/react-query';

import { platformStatsService } from '@/features/admin/services/platform-stats.service';
import type { PlatformStats } from '@/features/admin/types/platform-stats';

import { adminKeys } from './queryKeys';

/**
 * AdminDashboard's platform-stats read — one admin-guarded GET
 * (/api/admin/platform-stats, new engine) behind the `platformStats` key.
 * Read-only; replaces the dead five-RPC Supabase composite.
 */
export function usePlatformStats(): {
  data: PlatformStats | undefined;
  loading: boolean;
  isError: boolean;
} {
  const query = useQuery({
    queryKey: adminKeys.platformStats(),
    queryFn: () => platformStatsService.getPlatformStats(),
  });
  return { data: query.data, loading: query.isLoading, isError: query.isError };
}
