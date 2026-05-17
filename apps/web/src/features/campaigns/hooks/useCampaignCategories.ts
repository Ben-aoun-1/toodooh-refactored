import { useQuery } from '@tanstack/react-query';

import { campaignService } from '@/features/campaigns/services/campaign.service';

import { campaignsKeys } from './queryKeys';

/**
 * Persisted `campaign_categories` for a campaign — edit-mode hydration for the
 * campaign wizard (`NewCampaign`, Commit 7a).
 *
 * Wraps `campaignService.getCampaignCategories` (D4). `campaignId` is
 * `undefined` outside edit mode (or before the draft ID exists); the query is
 * disabled in that case, so it fires once, only when editing an existing
 * campaign. The wizard seeds its `categories` client state from the result
 * via a guarded derive effect (CF-16).
 */
export function useCampaignCategories(campaignId: string | undefined): {
  categories: string[];
  loading: boolean;
} {
  const query = useQuery({
    queryKey: campaignsKeys.categories(campaignId ?? ''),
    queryFn: () => campaignService.getCampaignCategories(campaignId as string),
    enabled: Boolean(campaignId),
  });

  return {
    categories: query.data ?? [],
    loading: query.isLoading,
  };
}
