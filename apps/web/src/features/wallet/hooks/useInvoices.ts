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
 * FCT2 relabel — these rows are the « Récapitulatifs de commande »: every row of
 * GET /api/recharges/mine carries its reference, and the server renders the PDF on demand
 * (GET /api/recharges/:id/facture — recapitulatif-<ref>.pdf). The REAL factures are the MONTHLY
 * consolidated ones (useMonthlyInvoices below). Shares the walletKeys.recharges cache with the
 * ledger. Focus-refetch 'always': statuses move on admin action in another session.
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

/** FCT2 — the monthly consolidated invoices (US-FCT-11): the ONE real facture per month. */
export function useMonthlyInvoices(userId: string | undefined) {
  return useQuery({
    queryKey: walletKeys.invoices(userId ?? ''),
    queryFn: () => walletService.listInvoices(),
    enabled: !!userId,
    refetchOnWindowFocus: 'always',
  });
}
