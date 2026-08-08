import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { type TransactionView, transactionView } from '@/features/wallet/lib/wallet-ledger';
import { walletService } from '@/features/wallet/services/wallet.service';

import { walletKeys } from './queryKeys';

export type Transaction = TransactionView;

interface UseWalletTransactionsResult {
  /** FIX2 — the display headline: spendable (what the funded gates enforce). */
  spendableTnd: number;
  /** The full balance (credits − net settlements ± adjustments) — « Solde total ». */
  totalTnd: number;
  /** Σ GROSS budgets of confirmed-but-unsettled campaigns. */
  engagedTnd: number;
  transactions: Transaction[];
  loading: boolean;
  isError: boolean;
}

/**
 * FIX2 — ONE served read (GET /api/wallet/transactions): the complete ledger AND the solde block
 * come from the same api call, so the rows and the figures can never disagree. Replaces the
 * client-side composition over recharges + campaigns + adjustments (the retired composeLedger).
 *
 * Refetches on window focus ('always', overriding the app-wide false): an admin confirms
 * transfers from another session, so returning to this tab must show the credit without a
 * manual refresh.
 */
export function useWalletTransactions(userId: string | undefined): UseWalletTransactionsResult {
  const ledgerQuery = useQuery({
    queryKey: walletKeys.transactions(userId ?? ''),
    queryFn: () => walletService.getTransactions(),
    enabled: !!userId,
    refetchOnWindowFocus: 'always',
  });

  const transactions = useMemo(
    () => (ledgerQuery.data?.transactions ?? []).map(transactionView),
    [ledgerQuery.data],
  );

  return {
    spendableTnd: ledgerQuery.data?.solde.spendable_tnd ?? 0,
    totalTnd: ledgerQuery.data?.solde.total_tnd ?? 0,
    engagedTnd: ledgerQuery.data?.solde.engaged_tnd ?? 0,
    transactions,
    loading: ledgerQuery.isLoading,
    isError: ledgerQuery.isError,
  };
}
