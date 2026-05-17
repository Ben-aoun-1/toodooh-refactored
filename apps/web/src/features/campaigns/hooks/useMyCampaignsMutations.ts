import { useMutation, useQueryClient } from '@tanstack/react-query';

import { adminKeys } from '@/features/admin/hooks/queryKeys';
import { advertiserKeys } from '@/features/advertiser/hooks/queryKeys';
import { campaignService } from '@/features/campaigns/services/campaign.service';
import { screenhostKeys } from '@/features/screenhost/hooks/queryKeys';
import { supabase } from '@/lib/supabase';
import { balanceService } from '@/services/balance.service';

import { campaignsKeys } from './queryKeys';
import type { MyCampaignRow } from './useMyCampaigns';

interface DeleteCampaignInput {
  campaignId: string;
  userId: string;
}

interface ActivateDraftInput {
  campaign: Pick<MyCampaignRow, 'id' | 'content_validation_status' | 'video_id'>;
  userId: string;
}

/** Outcome of an activate-draft attempt — drives the page's toast / navigation. */
export type ActivateDraftOutcome = 'insufficient' | 'active' | 'pending';

// TODO(phase-1): typed source [supabase] — see #15
const isMissingValidationNotesColumn = (error: { code?: string; message?: string } | null) =>
  error?.code === 'PGRST204' && String(error?.message || '').includes('validation_notes');

/**
 * `MyCampaigns` list-management write mutations (Commit 7b).
 *
 * `activateDraftCampaign` is one unit-of-work mutationFn (balance check →
 * video-validation read → status write with `validation_notes`-missing-column
 * fallback → publication-schedule injection) — the `useConfirmCartLaunch`
 * precedent. The former hand-patched optimistic `setCampaigns` writes are
 * dropped: both mutations invalidate-and-refetch (the locked default).
 *
 * CF-14 invalidation graph:
 * - (a) within-session — `campaignsKeys.all`: the advertiser's `MyCampaigns`
 *   list.
 * - (a) within-session — `advertiserKeys.all`: the dashboard's campaign count
 *   and (on activation) balance — money-adjacent, CLAUDE.md rule 10.
 * - (b) cross-session cross-role — `adminKeys.monitoringCampaigns()` /
 *   `monitoringStats()`: admin `CampaignMonitoring`.
 * - (b) cross-session cross-role — `screenhostKeys.all`: an activation injects
 *   the publication schedule, creating owner approval entries. `deleteCampaign`
 *   skips this key (a draft has no owner-side presence).
 */
export function useMyCampaignsMutations() {
  const queryClient = useQueryClient();

  const invalidateAdvertiserSide = () => {
    queryClient.invalidateQueries({ queryKey: campaignsKeys.all });
    queryClient.invalidateQueries({ queryKey: advertiserKeys.all });
    queryClient.invalidateQueries({ queryKey: adminKeys.monitoringCampaigns() });
    queryClient.invalidateQueries({ queryKey: adminKeys.monitoringStats() });
  };

  const deleteCampaign = useMutation({
    mutationFn: async ({ campaignId, userId }: DeleteCampaignInput): Promise<void> => {
      const { error } = await supabase
        .from('campaigns')
        .delete()
        .eq('id', campaignId)
        .eq('user_id', userId)
        .eq('status', 'draft');
      if (error) throw error;
    },
    onSuccess: invalidateAdvertiserSide,
  });

  const activateDraftCampaign = useMutation({
    mutationFn: async ({ campaign, userId }: ActivateDraftInput): Promise<ActivateDraftOutcome> => {
      const balanceCheck = await balanceService.checkCampaignBalance(campaign.id);
      const hasSufficientBalance = Boolean(balanceCheck?.has_sufficient_balance);
      const insufficientMessage =
        balanceCheck?.message || 'Solde insuffisant pour activer la campagne.';

      let videoIsValidated = campaign.content_validation_status === 'approved';
      if (!videoIsValidated && campaign.video_id) {
        const { data: video } = await supabase
          .from('videos')
          .select('validation_status')
          .eq('id', campaign.video_id)
          .single();
        videoIsValidated = video?.validation_status === 'approved';
      }

      if (!hasSufficientBalance) {
        let { error: updateDraftError } = await supabase
          .from('campaigns')
          .update({
            status: 'draft',
            content_validation_status: 'pending',
            validation_notes: insufficientMessage,
          })
          .eq('id', campaign.id)
          .eq('user_id', userId);

        if (isMissingValidationNotesColumn(updateDraftError)) {
          const { error: fallbackError } = await supabase
            .from('campaigns')
            .update({ status: 'draft', content_validation_status: 'pending' })
            .eq('id', campaign.id)
            .eq('user_id', userId);
          updateDraftError = fallbackError;
        }

        if (updateDraftError) throw updateDraftError;
        return 'insufficient';
      }

      const nextStatus: ActivateDraftOutcome = videoIsValidated ? 'active' : 'pending';
      let { error: updateError } = await supabase
        .from('campaigns')
        .update({
          status: nextStatus,
          content_validation_status: videoIsValidated ? 'approved' : 'pending',
          validation_notes: null,
        })
        .eq('id', campaign.id)
        .eq('user_id', userId);

      if (isMissingValidationNotesColumn(updateError)) {
        const { error: fallbackError } = await supabase
          .from('campaigns')
          .update({
            status: nextStatus,
            content_validation_status: videoIsValidated ? 'approved' : 'pending',
          })
          .eq('id', campaign.id)
          .eq('user_id', userId);
        updateError = fallbackError;
      }

      if (updateError) throw updateError;

      if (nextStatus === 'active') {
        await campaignService.injectCampaignPublicationSchedule(campaign.id);
      }
      return nextStatus;
    },
    onSuccess: (outcome) => {
      invalidateAdvertiserSide();
      // (b) an activation reaches the owner approval surface.
      if (outcome === 'active') {
        queryClient.invalidateQueries({ queryKey: screenhostKeys.all });
      }
    },
  });

  return { deleteCampaign, activateDraftCampaign };
}
