import { useQuery } from '@tanstack/react-query';

import { campaignsKeys } from '@/features/campaigns/hooks/queryKeys';
import { coverageService } from '@/features/campaigns/services/campaign-coverage.service';

/**
 * The screenhosts matching a campaign's persisted targeting (category × class) — the data behind the
 * Couverture-step coverage map. `campaignId` may be null (the create-early draft is not yet written);
 * the query then stays idle and yields an empty set. Targeting is edited on the previous step and
 * persisted independently, so the default refetch-on-mount makes the map reflect the latest lines
 * each time the advertiser lands on Couverture.
 */
export function useCampaignCoverage(campaignId: string | null) {
  const query = useQuery({
    queryKey: campaignsKeys.coverage(campaignId ?? ''),
    queryFn: () => coverageService.get(campaignId as string),
    enabled: Boolean(campaignId),
  });

  return {
    screenhosts: query.data ?? [],
    isLoading: Boolean(campaignId) && query.isLoading,
    isError: query.isError,
  };
}
