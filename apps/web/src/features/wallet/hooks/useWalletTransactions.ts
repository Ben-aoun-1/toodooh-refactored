import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { useMyCampaignsList } from '@/features/campaigns/hooks/useCampaignApi';
import { type LedgerTransaction, composeLedger } from '@/features/wallet/lib/wallet-ledger';
import { walletService } from '@/features/wallet/services/wallet.service';

import { walletKeys } from './queryKeys';

export type Transaction = LedgerTransaction;

interface UseWalletTransactionsResult {
  balance: number;
  transactions: Transaction[];
  loading: boolean;
  isError: boolean;
}

/**
 * CF-M1 — the MyRecharges composite, now fed by the LIVE api: the derived balance
 * (GET /api/wallet/balance) plus a ledger COMPOSED client-side from GET /api/recharges/mine
 * (confirmed credits) and GET /api/campaigns/mine (reconciled spend debits — the campaigns query
 * is the SAME cache entry MyCampaigns uses). Replaces the disabled Supabase merge.
 *
 * The money queries refetch on window focus ('always', overriding the app-wide false): an admin
 * confirms transfers from another session, so returning to this tab must show the credited
 * balance without a manual refresh.
 */
export function useWalletTransactions(userId: string | undefined): UseWalletTransactionsResult {
  const balanceQuery = useQuery({
    queryKey: walletKeys.balance(userId ?? ''),
    queryFn: () => walletService.getBalance(),
    enabled: !!userId,
    refetchOnWindowFocus: 'always',
  });
  const rechargesQuery = useQuery({
    queryKey: walletKeys.recharges(userId ?? ''),
    queryFn: () => walletService.listMyRecharges(),
    enabled: !!userId,
    refetchOnWindowFocus: 'always',
  });
  const campaignsQuery = useMyCampaignsList(userId);

  const transactions = useMemo(
    () => composeLedger(rechargesQuery.data ?? [], campaignsQuery.data ?? []),
    [rechargesQuery.data, campaignsQuery.data],
  );

  return {
    balance: balanceQuery.data?.balance_tnd ?? 0,
    transactions,
    loading: balanceQuery.isLoading || rechargesQuery.isLoading || campaignsQuery.isLoading,
    isError: balanceQuery.isError || rechargesQuery.isError || campaignsQuery.isError,
  };
}
