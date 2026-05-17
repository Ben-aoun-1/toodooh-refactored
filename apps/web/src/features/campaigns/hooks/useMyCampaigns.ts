import { useQuery } from '@tanstack/react-query';

import { matchPredefinedZoneNames } from '@/features/campaigns/lib/campaign-zone-match';
import { logger } from '@/lib/logger';
import { supabase } from '@/lib/supabase';

import { campaignsKeys } from './queryKeys';

const log = logger.child({ module: 'useMyCampaigns' });

// TODO(phase-1): typed source [supabase] — see #15
const isMissingCampaignCategoriesTable = (error: { code?: string; message?: string } | null) =>
  error?.code === 'PGRST205' && String(error?.message || '').includes('campaign_categories');

/** A campaign row as the `MyCampaigns` list renders it (categories + zone labels joined). */
export interface MyCampaignRow {
  id: string;
  name: string;
  client: string;
  client_id: string | null;
  category: string | null;
  startDate: Date;
  endDate: Date;
  start_date: string;
  end_date: string;
  status: string;
  views: number;
  budget: number;
  location_lat: number | null;
  location_lng: number | null;
  location_radius: number | null;
  video_id: string | null;
  event_id: string | undefined;
  content_validation_status: string | null;
  created_at: string;
  user_id: string;
  selected_categories: string[];
  selected_zones: string[];
  validated_impressions: number;
}

/**
 * The signed-in advertiser's campaign list (`MyCampaigns`).
 *
 * Commit 7b — consumes `campaignsKeys.list(userId)`, the key 7a's
 * campaign-write mutations already invalidate (the forward-compatible handoff
 * realised). A composite read: the campaigns+clients join, the batched
 * `campaign_categories` (`.in()` over every campaign id) and the
 * `predefined_zones` reference set all sit inside one `queryFn` — the
 * categories are denormalised into each row, so consumers read campaigns with
 * categories + zone labels already joined (one query, one loading state — the
 * `useMyEventCampaigns` / `useOwnerCampaignsOverview` composite precedent).
 * The zone label match is the shared `matchPredefinedZoneNames` pure function.
 */
export function useMyCampaigns(userId: string | undefined): {
  campaigns: MyCampaignRow[];
  loading: boolean;
  isError: boolean;
} {
  const query = useQuery({
    queryKey: campaignsKeys.list(userId ?? ''),
    queryFn: async (): Promise<MyCampaignRow[]> => {
      const { data: campaignsData, error } = await supabase
        .from('campaigns')
        .select(
          `
            *,
            client:clients(id, name)
          `,
        )
        .eq('user_id', userId as string)
        .order('created_at', { ascending: false });

      if (error) throw error;

      const campaignIds = (campaignsData || []).map((c: { id: string }) => c.id).filter(Boolean);
      const categoriesByCampaign = new Map<string, string[]>();
      const zonesByCampaign = new Map<string, string[]>();

      if (campaignIds.length > 0) {
        const [{ data: categoryRows, error: categoryError }, { data: predefinedZonesRows }] =
          await Promise.all([
            supabase
              .from('campaign_categories')
              .select('campaign_id, category')
              .in('campaign_id', campaignIds),
            supabase
              .from('predefined_zones')
              .select('name, latitude, longitude, radius')
              .eq('is_active', true),
          ]);

        if (categoryError && !isMissingCampaignCategoriesTable(categoryError)) {
          log.error({ categoryError }, 'Error fetching campaign categories');
        }

        (categoryRows || []).forEach((row: { campaign_id?: string; category?: string }) => {
          if (!row?.campaign_id || !row?.category) return;
          const prev = categoriesByCampaign.get(row.campaign_id) || [];
          if (!prev.includes(row.category)) prev.push(row.category);
          categoriesByCampaign.set(row.campaign_id, prev);
        });

        (campaignsData || []).forEach(
          (c: { id: string; location_lat?: unknown; location_lng?: unknown; location_radius?: unknown }) => {
            zonesByCampaign.set(
              c.id,
              matchPredefinedZoneNames(
                c.location_lat as number,
                c.location_lng as number,
                c.location_radius as number,
                predefinedZonesRows || [],
              ),
            );
          },
        );
      }

      // `c` infers `any` from the untyped supabase result (database types are
      // a Phase 1 concern, #15); the mapped output is the typed `MyCampaignRow`.
      return (campaignsData || []).map(
        (c): MyCampaignRow => ({
          selected_categories: categoriesByCampaign.get(c.id) || (c.category ? [c.category] : []),
          selected_zones: zonesByCampaign.get(c.id) || [],
          validated_impressions: Math.max(0, Number(c.views) || 0),
          id: c.id,
          name: c.name,
          client: c.client?.name || 'N/A',
          client_id: c.client_id ?? null,
          category: c.category ?? null,
          startDate: new Date(c.start_date),
          endDate: new Date(c.end_date),
          start_date: c.start_date,
          end_date: c.end_date,
          status: c.status,
          views: c.views || 0,
          budget: parseFloat(c.budget) || 0,
          location_lat: c.location_lat ?? null,
          location_lng: c.location_lng ?? null,
          location_radius: c.location_radius ?? null,
          video_id: c.video_id ?? null,
          event_id: c.event_id ?? undefined,
          content_validation_status: c.content_validation_status ?? null,
          created_at: c.created_at,
          user_id: c.user_id,
        }),
      );
    },
    enabled: Boolean(userId),
  });

  return {
    campaigns: query.data ?? [],
    loading: query.isLoading,
    isError: query.isError,
  };
}
