import { useMutation, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';

import { walletKeys } from './queryKeys';

export interface CreateRechargeInput {
  amount: number;
}

/**
 * Creates a wallet recharge via the engine (`POST /api/recharges`). The new
 * model is BANK-TRANSFER only (no online gateway, no payment method / free-text
 * description): the advertiser submits an amount, the engine writes a PENDING
 * recharge plus a downloadable facture reference, and an admin later confirms
 * receipt to credit the DERIVED balance. The advertiser is taken from the
 * session cookie server-side — no `user_id` in the body.
 *
 * A pending recharge is not yet reflected in the balance or the ledger, so this
 * is effectively a fire-and-forget submission. onSuccess still invalidates the
 * ledger and the invoice list (the facture is downloadable immediately): the
 * balance-changing event is the admin-side confirmation, not this creation.
 */
export function useCreateRecharge(userId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateRechargeInput) => {
      await apiClient.post('/recharges', { amount: input.amount });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: walletKeys.transactions(userId ?? '') });
      queryClient.invalidateQueries({ queryKey: walletKeys.invoices(userId ?? '') });
    },
  });
}
