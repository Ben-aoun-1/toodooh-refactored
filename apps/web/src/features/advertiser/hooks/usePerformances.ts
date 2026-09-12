import { useQuery } from '@tanstack/react-query';

import {
  type AnalysisQuery,
  analysisPath,
  performancesService,
} from '../services/performances.service';

import { advertiserKeys } from './queryKeys';

/**
 * SC-P — the React Query reads behind « Mes performances » (Screencaster). Owner-page idiom:
 * one hook per endpoint, the raw UseQueryResult returned (the page gates on pending/error through
 * readsState, so `?? []` defaults never masquerade as « no data yet »). The live counters poll
 * every minute (US-1.1 « temps réel ou quasi temps réel »).
 */

export const LIVE_POLL_INTERVAL_MS = 60_000;

export function useClosedCampaigns(userId: string | undefined) {
  return useQuery({
    queryKey: advertiserKeys.performancesClosed(userId ?? ''),
    queryFn: () => performancesService.listClosed(),
    enabled: Boolean(userId),
  });
}

export function useLiveCampaigns(userId: string | undefined) {
  return useQuery({
    queryKey: advertiserKeys.performancesLive(userId ?? ''),
    queryFn: () => performancesService.listLive(),
    enabled: Boolean(userId),
    refetchInterval: LIVE_POLL_INTERVAL_MS,
  });
}

export function useFootprint(userId: string | undefined) {
  return useQuery({
    queryKey: advertiserKeys.performancesFootprint(userId ?? ''),
    queryFn: () => performancesService.footprint(),
    enabled: Boolean(userId),
  });
}

/** `query` null = nothing to analyse yet (pre-first-clôture, or an incomplete custom range). */
export function useAnalysis(userId: string | undefined, query: AnalysisQuery | null) {
  const path = query ? analysisPath(query) : '';
  return useQuery({
    queryKey: advertiserKeys.performancesAnalysis(userId ?? '', path),
    queryFn: () => performancesService.analysis(query as AnalysisQuery),
    enabled: Boolean(userId) && query !== null,
    placeholderData: (prev) => prev,
  });
}
