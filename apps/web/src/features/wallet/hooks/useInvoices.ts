import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { type InvoiceRow, invoiceRows } from '@/features/wallet/lib/wallet-ledger';
import { walletService } from '@/features/wallet/services/wallet.service';

import { walletKeys } from './queryKeys';

interface UseInvoicesResult {
  invoices: InvoiceRow[];
  loading: boolean;
}

/**
 * CF-M1 — the factures ARE the recharges: every row of GET /api/recharges/mine carries its FCT-
 * reference, and the server renders the PDF on demand (GET /api/recharges/:id/facture). Shares
 * the walletKeys.recharges cache with the ledger; replaces the Supabase RPC/fallback chain (and
 * its `any` rows) with the typed live wire. Focus-refetch 'always': facture statuses move on
 * admin action in another session.
 */
export function useInvoices(userId: string | undefined): UseInvoicesResult {
  const query = useQuery({
    queryKey: walletKeys.recharges(userId ?? ''),
    queryFn: () => walletService.listMyRecharges(),
    enabled: !!userId,
    refetchOnWindowFocus: 'always',
  });

  const invoices = useMemo(() => invoiceRows(query.data ?? []), [query.data]);
  return { invoices, loading: query.isLoading };
}
