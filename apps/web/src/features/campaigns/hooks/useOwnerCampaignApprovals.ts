import { useQuery } from '@tanstack/react-query';

import {
  campaignOwnerApprovalService,
  type PendingCampaign,
} from '@/features/campaigns/services/campaign-owner-approval.service';

import { campaignsKeys } from './queryKeys';

/**
 * Campaigns awaiting a screen owner's approval (`OwnerCampaignApprovals`, and
 * `OwnerDashboard`'s pending-campaign notifications).
 *
 * Commit 7b. `campaign-owner-approval.service` lives under
 * `features/campaigns/services/`, so per D6 the hook + key land in the
 * campaigns feature even though both consumers are screenhost pages — the key
 * is `campaignsKeys.ownerApprovals(ownerId)`. This keeps it inside the
 * `campaignsKeys.all` prefix that 7a's `useConfirmCartLaunch` already
 * invalidates (no 7a amendment, no `screenhostKeys` alias).
 */
export function useOwnerCampaignApprovals(ownerId: string | undefined): {
  campaigns: PendingCampaign[];
  loading: boolean;
  isError: boolean;
  refetch: () => void;
} {
  const query = useQuery({
    queryKey: campaignsKeys.ownerApprovals(ownerId ?? ''),
    queryFn: () => campaignOwnerApprovalService.getPendingCampaigns(ownerId as string),
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
