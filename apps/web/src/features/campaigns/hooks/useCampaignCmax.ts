import { useQuery } from '@tanstack/react-query';

import { campaignsApi } from '../services/campaigns.api';

import { campaignsKeys } from './queryKeys';

/**
 * E5 (VF US-1.3) — the live C_max ceiling for the Validation-step budget cursor
 * (GET /api/campaigns/:id/cmax). Live-ish without hammering: a short staleTime keeps repeat
 * renders off the wire, focus-refetch 'always' (overriding the app-wide false) picks up occupancy
 * taken from another session — the same posture as the money queries. The server computes on live
 * occupancy every call; staleness is entirely this layer's.
 */
export const CMAX_STALE_TIME_MS = 30_000;

export function useCampaignCmax(campaignId: string | null) {
  return useQuery({
    queryKey: campaignsKeys.cmax(campaignId ?? ''),
    queryFn: () => campaignsApi.cmax(campaignId ?? ''),
    enabled: !!campaignId,
    staleTime: CMAX_STALE_TIME_MS,
    refetchOnWindowFocus: 'always',
  });
}
