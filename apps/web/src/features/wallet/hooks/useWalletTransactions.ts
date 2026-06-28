import { useQuery } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';

import { walletKeys } from './queryKeys';

export interface Transaction {
  id: string;
  type: 'recharge' | 'expense';
  designation: string;
  amount: number;
  date: Date;
  paymentMethod?: string;
}

/** Advertiser projection of a recharge (engine `rechargeView`). */
interface RechargeView {
  id: string;
  amount_tnd: number;
  status: 'pending' | 'confirmed' | 'rejected';
  reference: string;
  created_at: string;
}

/** Engine derived wallet balance (`GET /api/wallet/balance`). */
interface WalletBalanceView {
  balance_tnd: number;
  credited_tnd: number;
  debited_tnd: number;
  currency: string;
}

interface WalletTransactionsData {
  balance: number;
  transactions: Transaction[];
}

interface UseWalletTransactionsResult {
  balance: number;
  transactions: Transaction[];
  loading: boolean;
  isError: boolean;
}

/**
 * Composite read for MyRecharges, now on the engine: the DERIVED available
 * balance (`GET /api/wallet/balance`) plus the date-sorted ledger of CONFIRMED
 * recharges (`GET /api/recharges/mine?status=confirmed`).
 *
 * FLAG — per-campaign EXPENSE line items have no advertiser read API in the new
 * engine. The wallet balance exposes only the *aggregate* debit (`debited_tnd`,
 * summed from campaign_reconciliation, which is admin-only at write time); there
 * is no owner-scoped read of per-campaign spend. The ledger therefore lists
 * recharges only and the "Dépenses" tab is empty until a spend-line read API
 * lands. The former Supabase build derived expenses from `campaigns.budget`,
 * which is the requested/indicative budget — NOT the reconciled spend — so
 * reproducing it here would fabricate amounts that disagree with the balance.
 */
async function fetchWalletTransactions(): Promise<WalletTransactionsData> {
  const [balance, recharges] = await Promise.all([
    apiClient.get<WalletBalanceView>('/wallet/balance'),
    apiClient.get<RechargeView[]>('/recharges/mine?status=confirmed'),
  ]);

  const transactions: Transaction[] = recharges.map((r) => ({
    id: `r-${r.id}`,
    type: 'recharge',
    designation: 'Rechargement wallet',
    amount: r.amount_tnd,
    date: new Date(r.created_at),
    paymentMethod: 'Virement bancaire',
  }));

  transactions.sort((a, b) => b.date.getTime() - a.date.getTime());
  return { balance: balance.balance_tnd, transactions };
}

export function useWalletTransactions(userId: string | undefined): UseWalletTransactionsResult {
  const query = useQuery({
    queryKey: walletKeys.transactions(userId ?? ''),
    queryFn: fetchWalletTransactions,
    enabled: !!userId,
  });

  return {
    balance: query.data?.balance ?? 0,
    transactions: query.data?.transactions ?? [],
    loading: query.isLoading,
    isError: query.isError,
  };
}
