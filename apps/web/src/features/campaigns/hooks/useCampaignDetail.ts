import { useQuery } from '@tanstack/react-query';

import { matchPredefinedZoneNames } from '@/features/campaigns/lib/campaign-zone-match';
import { supabase } from '@/lib/supabase';

import { campaignsKeys } from './queryKeys';

// TODO(phase-1): typed source [supabase] — see #15
const isMissingCampaignCategoriesTable = (error: { code?: string; message?: string } | null) =>
  error?.code === 'PGRST205' && String(error?.message || '').includes('campaign_categories');

/** A single campaign as the `CampaignDetails` page renders it. */
export interface CampaignDetailRow {
  id: string;
  name: string;
  client?: string;
  category: string;
  start_date: string;
  end_date: string;
  status: string;
  budget: number;
  views: number;
  location_lat?: number;
  location_lng?: number;
  location_radius?: number;
  video_id?: string;
  content_validation_status?: string;
  created_at: string;
  user_id: string;
  selected_categories: string[];
  selected_zones: string[];
  validated_impressions: number;
}

/**
 * A single campaign's detail view (`CampaignDetails`).
 *
 * Commit 7b — consumes `campaignsKeys.detail(id)`, the key 7a's campaign-write
 * mutations already invalidate. Composite read (campaign row + categories +
 * predefined-zone match); the video is fetched separately by the shared
 * `useVideoById` hook.
 *
 * NOTE — preserved verbatim: the `Promise.all` fires a `campaign_locations`
 * query whose result the destructure discards (a dead fetch that predates
 * Step 10). Per CF-5-extended a migration commit does not fix incidental
 * pre-existing issues — filed as TBD-S for the Commit 9 audit refresh.
 */
export function useCampaignDetail(id: string | undefined): {
  campaign: CampaignDetailRow | null;
  loading: boolean;
  isError: boolean;
} {
  const query = useQuery({
    queryKey: campaignsKeys.detail(id ?? ''),
    queryFn: async (): Promise<CampaignDetailRow | null> => {
      const { data: campaignData, error: campaignError } = await supabase
        .from('campaigns')
        .select('*')
        .eq('id', id as string)
        .single();

      if (campaignError) throw campaignError;

      const [{ data: categoryRows, error: categoryError }] = await Promise.all([
        supabase.from('campaign_categories').select('category').eq('campaign_id', campaignData.id),
        // TBD-S: result discarded by the destructure — dead fetch, preserved verbatim.
        supabase
          .from('campaign_locations')
          .select('location_id')
          .eq('campaign_id', campaignData.id),
      ]);

      if (categoryError && !isMissingCampaignCategoriesTable(categoryError)) {
        throw categoryError;
      }

      const selectedCategories: string[] = (categoryRows || [])
        .map((row: { category?: string }) => row.category)
        .filter((category: string | undefined): category is string => Boolean(category));

      const { data: predefinedZonesRows } = await supabase
        .from('predefined_zones')
        .select('name, latitude, longitude, radius')
        .eq('is_active', true);

      const selectedZones = matchPredefinedZoneNames(
        campaignData?.location_lat,
        campaignData?.location_lng,
        campaignData?.location_radius,
        predefinedZonesRows || [],
      );

      return {
        id: campaignData.id,
        name: campaignData.name,
        client: campaignData.client,
        category: campaignData.category,
        start_date: campaignData.start_date,
        end_date: campaignData.end_date,
        status: campaignData.status,
        budget: campaignData.budget,
        views: campaignData.views,
        location_lat: campaignData.location_lat ?? undefined,
        location_lng: campaignData.location_lng ?? undefined,
        location_radius: campaignData.location_radius ?? undefined,
        video_id: campaignData.video_id ?? undefined,
        content_validation_status: campaignData.content_validation_status ?? undefined,
        created_at: campaignData.created_at,
        user_id: campaignData.user_id,
        selected_categories:
          selectedCategories.length > 0
            ? selectedCategories
            : campaignData.category
              ? [campaignData.category]
              : [],
        selected_zones: Array.from(new Set(selectedZones)),
        validated_impressions: Math.max(0, Number(campaignData.views) || 0),
      };
    },
    enabled: Boolean(id),
  });

  return {
    campaign: query.data ?? null,
    loading: query.isLoading,
    isError: query.isError,
  };
}
