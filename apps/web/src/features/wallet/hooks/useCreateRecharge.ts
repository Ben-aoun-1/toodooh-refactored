import { useMutation, useQueryClient } from '@tanstack/react-query';

import { supabase } from '@/lib/supabase';

import { walletKeys } from './queryKeys';

export interface CreateRechargeInput {
  amount: number;
  payment_method: string;
  description: string;
}

/**
 * Creates a wallet recharge in `status: 'pending'` (awaiting admin
 * validation). A pending recharge is not yet reflected in the balance or
 * the completed-transactions ledger, so this is effectively a fire-and-
 * forget submission — the original handler ran no post-insert refetch.
 *
 * onSuccess still invalidates `walletKeys.transactions` so the ledger is
 * the correct invalidation target the day a recharge transitions to
 * `completed` (admin approval — Commit 7). It is a near-no-op today
 * (pending rows are filtered out of the ledger) and is the right
 * invalidation graph regardless. The balance-changing event is the
 * admin-side approval, not this creation — that cross-feature
 * (advertiserKeys.dashboardStats) invalidation belongs to Commit 7.
 */
export function useCreateRecharge(userId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateRechargeInput) => {
      const { error } = await supabase
        .from('recharges')
        .insert({
          user_id: userId,
          amount: input.amount,
          payment_method: input.payment_method,
          status: 'pending',
          description: input.description,
        })
        .select()
        .single();
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: walletKeys.transactions(userId ?? '') });
    },
  });
}
