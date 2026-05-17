import { useMutation, useQueryClient } from '@tanstack/react-query';

import { adminKeys } from '@/features/admin/hooks/queryKeys';
import { advertiserKeys } from '@/features/advertiser/hooks/queryKeys';
import {
  campaignService,
  type CreateCampaignData,
} from '@/features/campaigns/services/campaign.service';
import { eventsKeys } from '@/features/events/hooks/queryKeys';
import { supabase } from '@/lib/supabase';

import { campaignsKeys } from './queryKeys';

/** Minimal slice of the campaign row `saveCampaignDraft` returns. */
export interface SavedCampaign {
  id: string;
}

interface SaveDraftInput {
  data: CreateCampaignData;
  campaignId?: string;
}

/** A status / validation patch applied to one `campaigns` row. */
export interface CampaignStatusPatch {
  status?: string;
  content_validation_status?: string;
}

interface UpdateCampaignInput {
  id: string;
  patch: CampaignStatusPatch;
}

interface LinkCampaignToEventInput {
  campaignId: string;
  eventId: string;
}

/**
 * Campaign-creation-flow write mutations (`NewCampaign`, Commit 7a).
 *
 * Per CF-13's first amendment the hooks are bundled by **mutationFn
 * identity**, not handler identity: the three `campaigns.update` call sites in
 * `NewCampaign` (the existing-draft save, the insufficient-balance revert, the
 * cart-add finalize) all share one `supabase.from('campaigns').update(patch)`
 * shape, so they collapse into a single `updateCampaign` whose argument is the
 * patch.
 *
 * CF-14 invalidation graph — `saveDraft` + `updateCampaign` reach the same
 * displayed views:
 * - (a) within-session — `campaignsKeys.all`: the prefix covers the
 *   advertiser's own `MyCampaigns` list (`campaignsKeys.list(userId)`, no
 *   reader until Commit 7b — invalidated forward-compatibly via the prefix,
 *   same shape as 6c's zone-key prerequisite) and the campaign detail key.
 * - (a) within-session — `advertiserKeys.all`: the advertiser dashboard's
 *   `dashboardStats` (campaign count) and `lastCampaigns` reads.
 * - (b) cross-session cross-role — `adminKeys.monitoringCampaigns()` /
 *   `monitoringStats()`: the admin `CampaignMonitoring` view sees the new /
 *   changed campaign. A no-op against the admin's uncached session here; kept
 *   for intent + hybrid-session defence — real freshness rides the admin
 *   consumer's `staleTime`.
 *
 * A draft / status-patch does not create an owner approval entry (those are
 * written server-side by `injectCampaignPublicationSchedule` on activation),
 * so no `screenhost` key is invalidated here — that reach belongs to
 * `useConfirmCartLaunch`.
 */
export function useCampaignMutations() {
  const queryClient = useQueryClient();

  const invalidateCampaignWrite = () => {
    // (a) advertiser-owned views — same session.
    queryClient.invalidateQueries({ queryKey: campaignsKeys.all });
    queryClient.invalidateQueries({ queryKey: advertiserKeys.all });
    // (b) admin monitoring — cross-session, no-op here, kept for intent.
    queryClient.invalidateQueries({ queryKey: adminKeys.monitoringCampaigns() });
    queryClient.invalidateQueries({ queryKey: adminKeys.monitoringStats() });
  };

  const saveDraft = useMutation({
    mutationFn: async ({ data, campaignId }: SaveDraftInput): Promise<SavedCampaign> => {
      // `saveCampaignDraft` is typed `Promise<any>` at the (pre-existing,
      // untyped) service layer; the result is narrowed here to `SavedCampaign`
      // so no `any` escapes into hook-consumer code.
      const campaign: SavedCampaign = await campaignService.saveCampaignDraft(data, campaignId);
      return campaign;
    },
    onSuccess: invalidateCampaignWrite,
  });

  const updateCampaign = useMutation({
    mutationFn: async ({ id, patch }: UpdateCampaignInput): Promise<void> => {
      const { error } = await supabase.from('campaigns').update(patch).eq('id', id);
      if (error) throw error;
    },
    onSuccess: invalidateCampaignWrite,
  });

  // CF-14 — `linkToEvent` attaches a campaign to a special event:
  // - (a) `campaignsKeys.all`: the campaign now carries an `event_id`.
  // - (a) `eventsKeys.all`: the advertiser's event-campaign links change.
  // - (b) `adminKeys.monitoringCampaigns()`: admin monitoring shows the link.
  const linkToEvent = useMutation({
    mutationFn: async ({ campaignId, eventId }: LinkCampaignToEventInput): Promise<void> => {
      const { error } = await supabase.rpc('link_campaign_to_event', {
        p_campaign_id: campaignId,
        p_event_id: eventId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: campaignsKeys.all });
      queryClient.invalidateQueries({ queryKey: eventsKeys.all });
      queryClient.invalidateQueries({ queryKey: adminKeys.monitoringCampaigns() });
    },
  });

  return { saveDraft, updateCampaign, linkToEvent };
}
