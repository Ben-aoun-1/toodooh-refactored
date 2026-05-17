import { useQuery } from '@tanstack/react-query';

import {
  revenueService,
  type RevenueData,
  type RevenueStats,
} from '@/features/wallet/services/revenue.service';

import { walletKeys } from './queryKeys';

interface UseRevenueStatsResult {
  stats: RevenueStats | undefined;
  loading: boolean;
  isError: boolean;
}

interface UseRevenueByPeriodResult {
  revenues: RevenueData[];
  loading: boolean;
  isError: boolean;
}

/**
 * Owner revenue summary (`revenueService.getRevenueStats`). The service is
 * session-scoped (it resolves the current user internally); `userId` is
 * passed only to key the cache per user. Consumed by `OwnerRevenue` and
 * `OwnerDashboard`.
 */
export function useRevenueStats(userId: string | undefined): UseRevenueStatsResult {
  const query = useQuery({
    queryKey: walletKeys.revenueStats(userId ?? ''),
    queryFn: () => revenueService.getRevenueStats(),
    enabled: !!userId,
  });

  return {
    stats: query.data,
    loading: query.isLoading,
    isError: query.isError,
  };
}

/**
 * Owner revenue series for one period bucket (`revenueService.getRevenueByPeriod`).
 * Consumed by `OwnerRevenue` (the monthly transactions table).
 */
export function useRevenueByPeriod(
  userId: string | undefined,
  period: 'monthly' | 'quarterly' | 'yearly',
): UseRevenueByPeriodResult {
  const query = useQuery({
    queryKey: walletKeys.revenueByPeriod(userId ?? '', period),
    queryFn: () => revenueService.getRevenueByPeriod(period),
    enabled: !!userId,
  });

  return {
    revenues: query.data ?? [],
    loading: query.isLoading,
    isError: query.isError,
  };
}
