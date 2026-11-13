import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { campaignsKeys } from '@/features/campaigns/hooks/queryKeys';

import { withCartReasonMessage } from '../lib/cart-confirm';
import type { ShownQuote } from '../lib/cart-quote';
import { cartApi } from '../services/cart.api';

import { cartKeys } from './queryKeys';

/**
 * CF-C1 — the cart read + mutations. ONE cache entry (cartKeys.read) shared by the page and
 * the floating widget; short staleTime + focus-refetch keep it live-ish (the money-query
 * posture). Confirm flips campaigns draft → pending, so it invalidates the campaigns list too.
 */
export function useCartRead(enabled = true, opts: { refetchOnMount?: 'always' } = {}) {
  return useQuery({
    queryKey: cartKeys.read(),
    queryFn: () => cartApi.read(),
    enabled,
    staleTime: 30_000,
    refetchOnWindowFocus: 'always',
    ...opts,
  });
}

export function useCartMutations(userId: string | undefined) {
  const queryClient = useQueryClient();
  const invalidateCart = () => queryClient.invalidateQueries({ queryKey: cartKeys.all });
  const invalidateCampaigns = () =>
    queryClient.invalidateQueries({ queryKey: campaignsKeys.list(userId ?? '') });

  // DISP-TOURS §3.1 — a campaign in the cart leaves « Mes campagnes » (and comes back when it is
  // kept as a draft): both moves refresh the campaigns list too.
  const addToCart = useMutation({
    // A refusal reads as its reason (« Aucun spot… »), not the gate's generic sentence.
    mutationFn: async (campaignId: string) => {
      try {
        return await cartApi.add(campaignId);
      } catch (err) {
        throw withCartReasonMessage(err);
      }
    },
    onSuccess: () => {
      void invalidateCart();
      void invalidateCampaigns();
    },
  });

  const removeFromCart = useMutation({
    mutationFn: (campaignId: string) => cartApi.remove(campaignId),
    onSuccess: () => {
      void invalidateCart();
      void invalidateCampaigns();
    },
  });

  const confirmCart = useMutation({
    mutationFn: (quotes: ShownQuote[]) => cartApi.confirm(quotes),
    onSuccess: () => {
      void invalidateCart();
      void invalidateCampaigns();
    },
    // DISP-TOURS §3.4 — a refused confirm re-reads the cart: the lines show the figures of now.
    onError: () => {
      void invalidateCart();
    },
  });

  return { addToCart, removeFromCart, confirmCart };
}
