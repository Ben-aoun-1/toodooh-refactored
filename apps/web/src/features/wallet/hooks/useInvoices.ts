import { useQuery } from '@tanstack/react-query';

import { logger } from '@/lib/logger';
import { supabase } from '@/lib/supabase';

import { walletKeys } from './queryKeys';

const log = logger.child({ module: 'useInvoices' });

interface UseInvoicesResult {
  // TODO(phase-1): typed source [supabase] — see #15
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  invoices: any[];
  loading: boolean;
}

/**
 * Loads the user's invoices via the `get_user_invoices_with_monthly` RPC,
 * falling back to `factures_with_campaigns` then the raw `factures` table.
 * Verbatim port of the former `[user]` effect — never throws; the worst
 * case is an empty list, logged.
 */
async function fetchInvoices(userId: string) {
  try {
    const { data, error } = await supabase.rpc('get_user_invoices_with_monthly', {
      p_user_id: userId,
    });

    if (error) {
      log.error({ error }, 'Error fetching invoices');
      let fallbackData, fallbackError;
      const fallbackQuery = await supabase
        .from('factures_with_campaigns')
        .select('*')
        .eq('user_id', userId)
        .order('date_emission', { ascending: false });

      if (fallbackQuery.error && fallbackQuery.error.code === 'PGRST116') {
        const directQuery = await supabase
          .from('factures')
          .select('*')
          .eq('user_id', userId)
          .order('date_emission', { ascending: false });
        fallbackData = directQuery.data;
        fallbackError = directQuery.error;
      } else {
        fallbackData = fallbackQuery.data;
        fallbackError = fallbackQuery.error;
      }

      if (fallbackError) {
        log.error({ fallbackError }, 'Error in fallback query');
        return [];
      }
      return fallbackData || [];
    }

    // TODO(phase-1): typed source [supabase] — see #15
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (data || []).map((invoice: any) => ({
      ...invoice,
      date_emission: invoice.date_emission
        ? new Date(invoice.date_emission).toISOString()
        : null,
      date_echeance: invoice.date_echeance
        ? new Date(invoice.date_echeance).toISOString()
        : null,
    }));
  } catch (err) {
    log.error({ err }, 'Error in fetchInvoices');
    return [];
  }
}

export function useInvoices(userId: string | undefined): UseInvoicesResult {
  const query = useQuery({
    queryKey: walletKeys.invoices(userId ?? ''),
    queryFn: () => fetchInvoices(userId as string),
    enabled: !!userId,
  });

  return {
    invoices: query.data ?? [],
    loading: query.isLoading,
  };
}
