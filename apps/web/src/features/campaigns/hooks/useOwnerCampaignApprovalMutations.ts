import { useMutation, useQueryClient } from '@tanstack/react-query';

import { adminKeys } from '@/features/admin/hooks/queryKeys';
import { advertiserKeys } from '@/features/advertiser/hooks/queryKeys';
import { campaignOwnerApprovalService } from '@/features/campaigns/services/campaign-owner-approval.service';
import { screenhostKeys } from '@/features/screenhost/hooks/queryKeys';

import { campaignsKeys } from './queryKeys';

interface ApproveCampaignInput {
  campaignId: string;
  screenIds?: string[];
}

interface RejectCampaignInput {
  campaignId: string;
  reason?: string;
}

/**
 * A screen owner's approve / reject decisions on campaigns targeting their
 * screens (`OwnerCampaignApprovals`, `OwnerCampaigns`).
 *
 * Commit 7b — `campaign-owner-approval.service` is campaigns-owned (D6), so
 * the hook lands here; `ownerId` is the hook argument (the service takes it
 * per call). Replaces `OwnerCampaigns`' hand-patched optimistic `setCampaigns`
 * writes with invalidate-and-refetch (the locked default — optimistic rollback
 * stays reserved for the Commit 8 bells).
 *
 * CF-14 invalidation graph — an approve / reject decision:
 * - (a) within-session — `campaignsKeys.all`: the owner's own approvals list
 *   (`campaignsKeys.ownerApprovals(ownerId)`) refetches.
 * - (a) within-session — `screenhostKeys.all`: the owner's `OwnerCampaigns`
 *   overview + `OwnerDashboard` notifications reflect the decision (an
 *   approval triggers the server-side publication schedule).
 * - (b) cross-session cross-role — `advertiserKeys.all`: the advertiser sees
 *   their campaign move to approved/active. No-op against the advertiser's
 *   uncached session; freshness rides their `staleTime`.
 * - (b) cross-session cross-role — `adminKeys.monitoringCampaigns()`: admin
 *   `CampaignMonitoring` reflects the status change.
 */
export function useOwnerCampaignApprovalMutations(ownerId: string | undefined) {
  const queryClient = useQueryClient();

  const invalidateApprovalDecision = () => {
    // (a) owner-side, same session.
    queryClient.invalidateQueries({ queryKey: campaignsKeys.all });
    queryClient.invalidateQueries({ queryKey: screenhostKeys.all });
    // (b) advertiser + admin — cross-session, no-ops here, kept for intent.
    queryClient.invalidateQueries({ queryKey: advertiserKeys.all });
    queryClient.invalidateQueries({ queryKey: adminKeys.monitoringCampaigns() });
  };

  const approveCampaign = useMutation({
    mutationFn: ({ campaignId, screenIds }: ApproveCampaignInput) =>
      campaignOwnerApprovalService.approveCampaign(campaignId, ownerId as string, screenIds),
    onSuccess: invalidateApprovalDecision,
  });

  const rejectCampaign = useMutation({
    mutationFn: ({ campaignId, reason }: RejectCampaignInput) =>
      campaignOwnerApprovalService.rejectCampaign(campaignId, ownerId as string, reason),
    onSuccess: invalidateApprovalDecision,
  });

  return { approveCampaign, rejectCampaign };
}
