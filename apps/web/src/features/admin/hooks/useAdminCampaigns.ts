import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { adminCampaignsService } from '@/features/admin/services/admin-campaigns.service';
import type {
  AdminCampaignRow,
  CampaignStatusFilter,
} from '@/features/admin/types/campaign-review';

import { adminKeys } from './queryKeys';

/** The admin campaign-review list, filtered by status. */
export function useAdminCampaigns(status: CampaignStatusFilter): {
  campaigns: AdminCampaignRow[];
  loading: boolean;
  isError: boolean;
} {
  const query = useQuery({
    queryKey: adminKeys.campaigns(status),
    queryFn: () => adminCampaignsService.list(status),
  });
  return {
    campaigns: query.data ?? [],
    loading: query.isLoading,
    isError: query.isError,
  };
}

/**
 * Activate (approve) / reject mutations for the campaign-review queue. Both throw ApiError on failure
 * (the page branches in its try/catch). On success we invalidate every campaign-review-list variant
 * (a flip changes which status bucket a campaign is in) PLUS the legacy monitoring views the activated
 * campaign also feeds, so those reads refetch. Activation runs the engine server-side (derive →
 * dispatch → status='active'); the FE supplies no engine inputs.
 */
export function useAdminCampaignMutations() {
  const queryClient = useQueryClient();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: adminKeys.campaignsAll() });
    queryClient.invalidateQueries({ queryKey: adminKeys.monitoringCampaigns() });
    queryClient.invalidateQueries({ queryKey: adminKeys.monitoringStats() });
    queryClient.invalidateQueries({ queryKey: adminKeys.platformStats() });
  };

  const activate = useMutation({
    mutationFn: (id: string) => adminCampaignsService.activate(id),
    onSuccess: invalidate,
  });

  const reject = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      adminCampaignsService.reject(id, reason),
    onSuccess: invalidate,
  });

  return { activate, reject };
}
