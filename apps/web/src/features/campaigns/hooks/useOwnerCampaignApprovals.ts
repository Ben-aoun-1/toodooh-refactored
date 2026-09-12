import { useQuery } from '@tanstack/react-query';

import { screenhostAllocationsService } from '@/features/screenhost/services/screenhost-allocations.service';

import { campaignsKeys } from './queryKeys';

/**
 * Campaigns awaiting the screen owner's decision — the OwnerDashboard's pending-campaign
 * notification list.
 *
 * SUPA-2 (2026-09-12): this was the LAST prod-reachable read through the retired Supabase proxy
 * (`campaign_owner_approvals`); the proxy throws in prod, react-query swallowed it, and the list
 * was permanently empty for every owner. It now reads the de-Supabased per-allocation model —
 * GET /api/screenhosts/allocations (the EN_ATTENTE queue the accept/reject page uses) — grouped
 * per campaign so the dashboard shape is unchanged.
 */
export interface PendingCampaign {
  campaign_id: string;
  campaign_name: string;
  campaign_start_date: string | null;
  campaign_end_date: string | null;
  approval_status: 'pending';
}

export function useOwnerCampaignApprovals(ownerId: string | undefined): {
  campaigns: PendingCampaign[];
  loading: boolean;
  isError: boolean;
  refetch: () => void;
} {
  const query = useQuery({
    queryKey: campaignsKeys.ownerApprovals(ownerId ?? ''),
    queryFn: async (): Promise<PendingCampaign[]> => {
      const rows = await screenhostAllocationsService.listPending();
      const byCampaign = new Map<string, PendingCampaign>();
      for (const r of rows) {
        if (!byCampaign.has(r.campaign_id)) {
          byCampaign.set(r.campaign_id, {
            campaign_id: r.campaign_id,
            campaign_name: r.campaign_name,
            campaign_start_date: r.start_date,
            campaign_end_date: r.end_date,
            approval_status: 'pending',
          });
        }
      }
      return [...byCampaign.values()];
    },
    enabled: Boolean(ownerId),
  });

  return {
    campaigns: query.data ?? [],
    loading: query.isLoading,
    isError: query.isError,
    refetch: () => {
      void query.refetch();
    },
  };
}
