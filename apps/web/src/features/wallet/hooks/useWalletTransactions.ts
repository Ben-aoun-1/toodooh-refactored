import { useQuery } from '@tanstack/react-query';

import { supabase } from '@/lib/supabase';
import { balanceService } from '@/services/balance.service';

import { walletKeys } from './queryKeys';

export interface Transaction {
  id: string;
  type: 'recharge' | 'expense';
  designation: string;
  amount: number;
  date: Date;
  paymentMethod?: string;
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
 * Composite read for MyRecharges: the available balance plus a merged,
 * date-sorted ledger of completed recharges and campaign expenses. Verbatim
 * port of the former `[user]` effect.
 */
async function fetchWalletTransactions(userId: string): Promise<WalletTransactionsData> {
  const balanceInfo = await balanceService.getBalanceInfo(userId);
  const balance = balanceInfo
    ? balanceInfo.available_balance
    : await balanceService.getUserBalance(userId);

  const merged: Transaction[] = [];

  const { data: rechargesData } = await supabase
    .from('recharges')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'completed')
    .order('created_at', { ascending: false });

  if (rechargesData) {
    rechargesData.forEach((r) => {
      merged.push({
        id: `r-${r.id}`,
        type: 'recharge',
        designation: 'Rechargement wallet',
        amount: parseFloat(r.amount) || 0,
        date: new Date(r.created_at),
        paymentMethod:
          r.payment_method === 'card'
            ? 'Carte Bancaire'
            : r.payment_method === 'bank'
              ? 'Virement'
              : 'Espèces',
      });
    });
  }

  const { data: campaignsData } = await supabase
    .from('campaigns')
    .select('id, name, budget, created_at')
    .eq('user_id', userId)
    .in('status', ['active', 'completed'])
    .order('created_at', { ascending: false });

  if (campaignsData) {
    campaignsData.forEach((c) => {
      const budgetTTC = (parseFloat(c.budget) || 0) * 1.19;
      merged.push({
        id: `c-${c.id}`,
        type: 'expense',
        designation: c.name || 'Campagne',
        amount: budgetTTC,
        date: new Date(c.created_at),
      });
    });
  }

  merged.sort((a, b) => b.date.getTime() - a.date.getTime());
  return { balance, transactions: merged };
}

export function useWalletTransactions(userId: string | undefined): UseWalletTransactionsResult {
  const query = useQuery({
    queryKey: walletKeys.transactions(userId ?? ''),
    queryFn: () => fetchWalletTransactions(userId as string),
    enabled: !!userId,
  });

  return {
    balance: query.data?.balance ?? 0,
    transactions: query.data?.transactions ?? [],
    loading: query.isLoading,
    isError: query.isError,
  };
}
