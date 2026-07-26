import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { type RechargeRow, walletService } from '@/features/wallet/services/wallet.service';

import { walletKeys } from './queryKeys';

/**
 * FCT1 — the recharge parcours v2 hooks (replaces useCreateRecharge, whose create-then-attach
 * seam died with the generic POST):
 *   useCreateVirement    — one multipart call, the justificatif is MANDATORY (validated upstream).
 *   useCreateBon         — the server renders + stores the bon PDF; the page opens the « Votre bon
 *                          de commande est prêt » popup on success.
 *   useDepositSignedBon  — bon_issued → bon_returned (the sub-section under Recharge rapide).
 *   useMyRecharges       — the demandes list (per-method status chips) + the bons to return.
 *   useBankCoordinates   — the « Pour info » quartet (config-backed; '—' = not provisioned).
 * Every mutation invalidates the live wallet keys — the balance stays untouched until an admin
 * validates, but a stale read must never survive the round-trip.
 */

export function useMyRecharges(userId: string | undefined) {
  return useQuery({
    queryKey: walletKeys.recharges(userId ?? ''),
    queryFn: () => walletService.listMyRecharges(),
    enabled: !!userId,
    refetchOnWindowFocus: 'always',
  });
}

export function useBankCoordinates() {
  return useQuery({
    queryKey: walletKeys.bankCoordinates(),
    queryFn: () => walletService.getBankCoordinates(),
  });
}

const useInvalidateWallet = (userId: string | undefined) => {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: walletKeys.recharges(userId ?? '') });
    void queryClient.invalidateQueries({ queryKey: walletKeys.balance(userId ?? '') });
  };
};

export function useCreateVirement(userId: string | undefined) {
  const invalidate = useInvalidateWallet(userId);
  return useMutation({
    mutationFn: ({ amount, file }: { amount: number; file: File }): Promise<RechargeRow> =>
      walletService.createVirement(amount, file),
    onSuccess: invalidate,
  });
}

export function useCreateBon(userId: string | undefined) {
  const invalidate = useInvalidateWallet(userId);
  return useMutation({
    mutationFn: ({ amount }: { amount: number }): Promise<RechargeRow> =>
      walletService.createBon(amount),
    onSuccess: invalidate,
  });
}

export function useDepositSignedBon(userId: string | undefined) {
  const invalidate = useInvalidateWallet(userId);
  return useMutation({
    mutationFn: ({ id, file }: { id: string; file: File }): Promise<RechargeRow> =>
      walletService.uploadSignedBon(id, file),
    onSuccess: invalidate,
  });
}
