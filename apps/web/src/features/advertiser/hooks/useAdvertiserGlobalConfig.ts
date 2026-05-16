import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import {
  type DoohConfigNumbers,
  DEFAULT_DOOH_CONFIG_NUMBERS,
} from '@/lib/dooh/legacy/dooh-calculation.service';
import {
  getDoohConfigNumbers,
  invalidateGlobalConfigurationCache,
} from '@/services/global-configuration.service';

import { advertiserKeys } from './queryKeys';

export type AdvertiserGlobalConfigState = {
  dooh: DoohConfigNumbers;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
};

/**
 * Paramètres globaux pour parcours annonceur (CPM, durées vidéo affichées, etc.).
 *
 * `refresh` clears the global-configuration service cache and invalidates the
 * React Query cache entry, which triggers a refetch — replacing the hook's
 * former hand-rolled refetch. Interface preserved so `NewCampaign.tsx`
 * (the only consumer) is untouched.
 */
export function useAdvertiserGlobalConfig(): AdvertiserGlobalConfigState {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: advertiserKeys.globalConfig(),
    queryFn: getDoohConfigNumbers,
  });

  const refresh = useCallback(async () => {
    invalidateGlobalConfigurationCache();
    await queryClient.invalidateQueries({ queryKey: advertiserKeys.globalConfig() });
  }, [queryClient]);

  return {
    dooh: query.data ?? DEFAULT_DOOH_CONFIG_NUMBERS,
    loading: query.isLoading,
    error: query.error
      ? query.error instanceof Error
        ? query.error.message
        : 'Erreur de chargement de la configuration'
      : null,
    refresh,
  };
}
