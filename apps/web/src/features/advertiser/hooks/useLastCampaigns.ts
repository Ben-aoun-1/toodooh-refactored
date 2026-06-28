import { useQuery } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';

import { advertiserKeys } from './queryKeys';

/** Engine campaign projection (`campaignView`) returned by GET /api/campaigns/mine. */
interface CampaignView {
  id: string;
  name: string;
  campaign_type: string;
  status: string;
  start_date: string | null;
  end_date: string | null;
  description: string | null;
  requested_budget: number | null;
  content_validation_status: string | null;
  submitted_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * A "last campaign" card as the dashboard grid consumes it.
 *
 * FLAG — the engine `/api/campaigns/mine` exposes no TARGETING (the legacy
 * `selected_categories` / `selected_zones` came from Supabase
 * `campaign_categories` + `predefined_zones`) and no DELIVERED IMPRESSIONS
 * (those came from reconciliation). Those fields are therefore dropped rather
 * than fabricated; `budget` is the indicative requested budget.
 */
export interface LastCampaign {
  id: string;
  name: string;
  status: string;
  start_date: string;
  end_date: string;
  budget: number;
  selected_categories: string[];
  selected_zones: string[];
}

async function fetchLastCampaigns(limit: number): Promise<LastCampaign[]> {
  // The engine returns the caller's campaigns newest-first, so the first `limit` are the latest.
  const campaigns = await apiClient.get<CampaignView[]>('/campaigns/mine');
  return campaigns.slice(0, limit).map((c) => ({
    id: c.id,
    name: c.name || 'Sans nom',
    status: c.status || 'draft',
    start_date: c.start_date ?? '',
    end_date: c.end_date ?? '',
    budget: c.requested_budget ?? 0,
    selected_categories: [],
    selected_zones: [],
  }));
}

export function useLastCampaigns(userId: string | undefined, limit = 5): UseLastCampaignsResult {
  const query = useQuery({
    queryKey: advertiserKeys.lastCampaigns(userId ?? '', limit),
    queryFn: () => fetchLastCampaigns(limit),
    enabled: !!userId,
  });

  return {
    campaigns: query.data ?? [],
    loading: query.isLoading,
    error: query.error,
  };
}

interface UseLastCampaignsResult {
  campaigns: LastCampaign[];
  loading: boolean;
  error: Error | null;
}
