import { useQuery } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';

import { walletKeys } from './queryKeys';

/** Advertiser projection of a recharge (engine `rechargeView`). */
interface RechargeView {
  id: string;
  amount_tnd: number;
  status: 'pending' | 'confirmed' | 'rejected';
  reference: string;
  created_at: string;
}

/**
 * An invoice row as the MyInvoices table consumes it. In the new engine an
 * invoice IS a recharge facture: each recharge carries an `FCT-` reference and
 * a server-rendered PDF (`GET /api/recharges/:id/facture`). The legacy fields
 * the page no longer has a source for (campaign_name, client_name, free-text
 * description, due date) are dropped — the engine model is recharge factures.
 */
export interface RechargeInvoice {
  id: string;
  numero: string;
  montant: number;
  date_emission: string;
  statut: 'pending' | 'confirmed' | 'rejected';
}

interface UseInvoicesResult {
  invoices: RechargeInvoice[];
  loading: boolean;
}

async function fetchInvoices(): Promise<RechargeInvoice[]> {
  const recharges = await apiClient.get<RechargeView[]>('/recharges/mine');
  return recharges.map((r) => ({
    id: r.id,
    numero: r.reference,
    montant: r.amount_tnd,
    date_emission: r.created_at,
    statut: r.status,
  }));
}

export function useInvoices(userId: string | undefined): UseInvoicesResult {
  const query = useQuery({
    queryKey: walletKeys.invoices(userId ?? ''),
    queryFn: fetchInvoices,
    enabled: !!userId,
  });

  return {
    invoices: query.data ?? [],
    loading: query.isLoading,
  };
}
