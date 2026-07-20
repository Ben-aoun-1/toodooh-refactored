import { useMutation, useQueryClient } from '@tanstack/react-query';

import {
  type CreateRechargeWithDocumentResult,
  createRechargeWithDocument,
} from '@/features/wallet/lib/recharge-document';
import { walletService } from '@/features/wallet/services/wallet.service';

import { walletKeys } from './queryKeys';

export interface CreateRechargeInput {
  amount: number;
  /** CF-M2 — the optional justificatif picked in the modal; uploaded right after the create. */
  file: File | null;
}

/**
 * CF-M1 — POST /api/recharges: creates a PENDING recharge (awaiting admin confirmation of the
 * bank transfer) and resolves the created row, whose FCT- `reference` the page surfaces — that
 * reference is the facture the advertiser wires against. CF-M2 chains the optional justificatif
 * upload behind the create (the two-call seam: a document failure RESOLVES with the created row +
 * `documentError`, never rejects — the recharge is kept and the document stays attachable from
 * Mes factures). Success invalidates the live wallet keys AFTER the whole seam, so the recharges
 * list lands with its has_document already true on the happy path; the balance is untouched until
 * the admin confirms (kept in the graph so a stale read never survives the round-trip).
 */
export function useCreateRecharge(userId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateRechargeInput): Promise<CreateRechargeWithDocumentResult> =>
      createRechargeWithDocument(
        {
          createRecharge: (amount) => walletService.createRecharge(amount),
          uploadJustificatif: (id, file) => walletService.uploadJustificatif(id, file),
        },
        input.amount,
        input.file,
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: walletKeys.recharges(userId ?? '') });
      void queryClient.invalidateQueries({ queryKey: walletKeys.balance(userId ?? '') });
    },
  });
}
