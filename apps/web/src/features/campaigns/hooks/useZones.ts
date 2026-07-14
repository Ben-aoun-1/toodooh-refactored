import { useQuery } from '@tanstack/react-query';

import { zonesApi } from '../services/zones.api';

import { campaignsKeys } from './queryKeys';

/**
 * CF-Z1 — the predefined zones for the wizard's « Zones géographiques » step (V1: Grand Tunis).
 * Active zones only; any authenticated user may read them.
 */
export function useZones() {
  return useQuery({
    queryKey: campaignsKeys.zones(),
    queryFn: () => zonesApi.list(),
  });
}
