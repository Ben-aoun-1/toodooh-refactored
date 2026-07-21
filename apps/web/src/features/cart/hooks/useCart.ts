import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { campaignsKeys } from '@/features/campaigns/hooks/queryKeys';

import { cartApi } from '../services/cart.api';

import { cartKeys } from './queryKeys';

/**
 * CF-C1 — the cart read + mutations. ONE cache entry (cartKeys.read) shared by the page and
 * the floating widget; short staleTime + focus-refetch keep it live-ish (the money-query
 * posture). Confirm flips campaigns draft → pending, so it invalidates the campaigns list too.
 */
export function useCartRead(enabled = true) {
  return useQuery({
    queryKey: cartKeys.read(),
    queryFn: () => cartApi.read(),
    enabled,
    staleTime: 30_000,
    refetchOnWindowFocus: 'always',
  });
}

export function useCartMutations(userId: string | undefined) {
  const queryClient = useQueryClient();
  const invalidateCart = () => queryClient.invalidateQueries({ queryKey: cartKeys.all });
  const invalidateCampaigns = () =>
    queryClient.invalidateQueries({ queryKey: campaignsKeys.list(userId ?? '') });

  const addToCart = useMutation({
    mutationFn: (campaignId: string) => cartApi.add(campaignId),
    onSuccess: () => {
      void invalidateCart();
    },
  });

  const removeFromCart = useMutation({
    mutationFn: (campaignId: string) => cartApi.remove(campaignId),
    onSuccess: () => {
      void invalidateCart();
    },
  });

  const confirmCart = useMutation({
    mutationFn: () => cartApi.confirm(),
    onSuccess: () => {
      void invalidateCart();
      void invalidateCampaigns();
    },
  });

  return { addToCart, removeFromCart, confirmCart };
}
