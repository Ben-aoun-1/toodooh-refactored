import { useMutation, useQueryClient } from '@tanstack/react-query';

import { type RechargeRow, walletService } from '@/features/wallet/services/wallet.service';

import { walletKeys } from './queryKeys';

export interface CreateRechargeInput {
  amount: number;
}

/**
 * CF-M1 — POST /api/recharges: creates a PENDING recharge (awaiting admin confirmation of the
 * bank transfer) and resolves the created row, whose FCT- `reference` the page surfaces — that
 * reference is the facture the advertiser wires against. Success invalidates the live wallet
 * keys: the recharges list gains the pending row immediately; the balance is untouched until the
 * admin confirms (kept in the graph so a stale read never survives the round-trip).
 */
export function useCreateRecharge(userId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateRechargeInput): Promise<RechargeRow> =>
      walletService.createRecharge(input.amount),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: walletKeys.recharges(userId ?? '') });
      void queryClient.invalidateQueries({ queryKey: walletKeys.balance(userId ?? '') });
    },
  });
}
