import { useQuery } from '@tanstack/react-query';

import { logger } from '@/lib/logger';
import { supabase } from '@/lib/supabase';

import { advertiserKeys } from './queryKeys';

const log = logger.child({ module: 'useLastCampaigns' });

export interface LastCampaign {
  id: string;
  name: string;
  status: string;
  start_date: string;
  end_date: string;
  budget: number;
  views: number;
  category: string | null;
  selected_categories: string[];
  selected_zones: string[];
  validated_impressions: number;
}

// TODO(phase-1): typed source [supabase] — see #15
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const isMissingCampaignCategoriesTable = (error: any) =>
  error?.code === 'PGRST205' && String(error?.message || '').includes('campaign_categories');

interface UseLastCampaignsResult {
  campaigns: LastCampaign[];
  loading: boolean;
  error: Error | null;
}

async function fetchLastCampaigns(userId: string, limit: number): Promise<LastCampaign[]> {
  const { data, error: fetchError } = await supabase
    .from('campaigns')
    .select('id, name, status, start_date, end_date, budget, views, category')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (fetchError) {
    log.error({ error: fetchError }, 'Error fetching last campaigns');
    throw new Error(fetchError.message);
  }

  const rows = data || [];
  // TODO(phase-1): typed source [supabase] — see #15
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const campaignIds = rows.map((c: any) => c.id).filter(Boolean);
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

    // TODO(phase-1): typed source [supabase] — see #15
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (categoryRows || []).forEach((row: any) => {
      if (!row?.campaign_id || !row?.category) return;
      const prev = categoriesByCampaign.get(row.campaign_id) || [];
      if (!prev.includes(row.category)) prev.push(row.category);
      categoriesByCampaign.set(row.campaign_id, prev);
    });

    // TODO(phase-1): typed source [supabase] — see #15
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rows.forEach((c: any) => {
      const lat = Number(c?.location_lat);
      const lng = Number(c?.location_lng);
      const radius = Number(c?.location_radius);
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(radius)) return;
      const matched = (predefinedZonesRows || []).find(
        // TODO(phase-1): typed source [supabase] — see #15
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (z: any) =>
          Math.abs(Number(z.latitude) - lat) <= 0.0005 &&
          Math.abs(Number(z.longitude) - lng) <= 0.0005 &&
          Math.abs(Number(z.radius) - radius) <= 50,
      );
      zonesByCampaign.set(c.id, matched?.name ? [matched.name] : ['Grand Tunis']);
    });
  }

  // TODO(phase-1): typed source [supabase] — see #15
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return rows.map((c: any) => {
    const selectedCategories = categoriesByCampaign.get(c.id) || (c.category ? [c.category] : []);
    return {
      id: c.id,
      name: c.name || 'Sans nom',
      status: c.status || 'draft',
      start_date: c.start_date || '',
      end_date: c.end_date || '',
      budget: parseFloat(String(c.budget)) || 0,
      views: c.views || 0,
      category: c.category || null,
      selected_categories: selectedCategories,
      selected_zones: zonesByCampaign.get(c.id) || [],
      validated_impressions: Math.max(0, Number(c.views) || 0),
    };
  });
}

export function useLastCampaigns(userId: string | undefined, limit = 5): UseLastCampaignsResult {
  const query = useQuery({
    queryKey: advertiserKeys.lastCampaigns(userId ?? '', limit),
    queryFn: () => fetchLastCampaigns(userId as string, limit),
    enabled: !!userId,
  });

  return {
    campaigns: query.data ?? [],
    loading: query.isLoading,
    error: query.error,
  };
}
