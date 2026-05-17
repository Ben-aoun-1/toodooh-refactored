import { useQuery } from '@tanstack/react-query';

import {
  campaignScreensService,
  type CampaignLocation,
} from '@/features/campaigns/services/campaign-screens.service';

import { campaignsKeys } from './queryKeys';

/**
 * Hydrated `CampaignLocation[]` for the campaign wizard's selected location
 * IDs (`NewCampaign`, Commit 7a) — affluence schedules + screen counts that
 * feed the DOOH impressions estimate.
 *
 * Wraps `campaignScreensService.getLocationsByIds` (D4). The service already
 * returns `[]` for an empty input; `enabled` additionally skips the query
 * entirely so an empty selection holds no cache entry.
 */
export function useCampaignLocations(locationIds: string[]): {
  locations: CampaignLocation[];
  loading: boolean;
} {
  const query = useQuery({
    queryKey: campaignsKeys.locations(locationIds),
    queryFn: () => campaignScreensService.getLocationsByIds(locationIds),
    enabled: locationIds.length > 0,
  });

  return {
    locations: query.data ?? [],
    loading: query.isLoading,
  };
}

/**
 * Active screen IDs belonging to the wizard's selected location IDs
 * (`NewCampaign`, Commit 7a) — used to scope the unavailability lookup.
 *
 * Wraps `campaignScreensService.getScreenIdsByLocationIds` (D4).
 */
export function useScreenIdsByLocations(locationIds: string[]): {
  screenIds: string[];
  loading: boolean;
} {
  const query = useQuery({
    queryKey: campaignsKeys.screenIds(locationIds),
    queryFn: () => campaignScreensService.getScreenIdsByLocationIds(locationIds),
    enabled: locationIds.length > 0,
  });

  return {
    screenIds: query.data ?? [],
    loading: query.isLoading,
  };
}
