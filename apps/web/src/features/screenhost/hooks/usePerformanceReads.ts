import { useQuery } from '@tanstack/react-query';

import { performanceService } from '../services/performance.service';

import { screenhostKeys } from './queryKeys';

/**
 * Lane F — the four React Query reads behind the "Mes performances" page. One concept: each hook
 * wraps ONE performanceService endpoint with its screenhostKeys entry, enabled only once its
 * scope (venue id / session user id) is known. Period filtering is client-side, so none of these
 * re-fetch when the pills change.
 */

export function useVenueProfile(screenhostId: string | null) {
  return useQuery({
    queryKey: screenhostKeys.profile(screenhostId ?? ''),
    queryFn: () => performanceService.getProfile(screenhostId as string),
    enabled: Boolean(screenhostId),
  });
}

export function useVenueMonthlyStats(screenhostId: string | null) {
  return useQuery({
    queryKey: screenhostKeys.monthlyStats(screenhostId ?? ''),
    queryFn: () => performanceService.getMonthlyStats(screenhostId as string),
    enabled: Boolean(screenhostId),
  });
}

/** `from`/`to` are the page's ONE maximal fetch window (≤ 400 days, the API bound) per venue. */
export function useVenueImpressionsDaily(screenhostId: string | null, from: string, to: string) {
  return useQuery({
    queryKey: screenhostKeys.impressionsDaily(screenhostId ?? '', from, to),
    queryFn: () => performanceService.getImpressionsDaily(screenhostId as string, from, to),
    enabled: Boolean(screenhostId),
  });
}

/** Session-scoped server-side; `userId` only keys the cache (the wallet-feature convention). */
export function useOwnerEarnings(userId: string | undefined) {
  return useQuery({
    queryKey: screenhostKeys.earnings(userId ?? ''),
    queryFn: () => performanceService.getEarnings(),
    enabled: Boolean(userId),
  });
}
