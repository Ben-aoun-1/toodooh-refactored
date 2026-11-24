import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { networkApi } from '@/features/network/services/network.api';

import { networkKeys } from './queryKeys';

export function useNetworkVenues() {
  return useQuery({ queryKey: networkKeys.venues(), queryFn: () => networkApi.network() });
}

export function useNetworkParks() {
  return useQuery({ queryKey: networkKeys.parks(), queryFn: () => networkApi.parks() });
}

/**
 * « Ne plus diffuser dans ces établissements » — one call for the whole selection. A venue can
 * also be a park's location, so both lists are refreshed; the mutation stays pending until they
 * are, so the page never shows the old state as if it were the new one.
 */
export function useExcludeScreenhosts() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (screenhostIds: string[]) => networkApi.exclude(screenhostIds),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: networkKeys.all }),
  });
}

/** « Réintégrer » — a park is reintegrated location by location. */
export function useReintegrateScreenhosts() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (screenhostIds: string[]) =>
      Promise.all(screenhostIds.map((id) => networkApi.reintegrate(id))),
    // Settled, not success: a half-done park reintegration must show what really went through.
    onSettled: () => queryClient.invalidateQueries({ queryKey: networkKeys.all }),
  });
}
