import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { campaignsKeys } from '@/features/campaigns/hooks/queryKeys';
import { toChipLabel } from '@/features/campaigns/lib/targeting-chip-label';
import { type CampaignView, campaignsApi } from '@/features/campaigns/services/campaigns.api';

// CF-HF3 — the dashboard « Mes campagnes » cards, repointed off the prod-dead Supabase read
// (lazy client throws → the grid always rendered empty) onto the LIVE campaigns wire. Shares the
// campaignsKeys.list(userId) cache with MyCampaigns — the mutations already invalidate it. The
// impressions fields ride the CF-HF3 display rule (prévues from the frozen plan / budget
// estimate; validées null-honest until reconcile).

export interface LastCampaign {
  id: string;
  name: string;
  status: string;
  campaign_type: string;
  start_date: string;
  end_date: string;
  /** NULL until the advertiser sets it (renders « — » — no phantom defaults). */
  budget: number | null;
  requested_budget: number | null;
  category: string | null;
  selected_categories: string[];
  selected_zones: string[];
  /** NULL until the admin reconcile writes delivered (null ≠ 0). */
  validated_impressions: number | null;
  planned_impressions: number | null;
}

const toLastCampaign = (c: CampaignView): LastCampaign => ({
  id: c.id,
  name: c.name || 'Sans nom',
  status: c.status || 'draft',
  campaign_type: c.campaign_type,
  start_date: c.start_date ?? '',
  end_date: c.end_date ?? '',
  budget: c.requested_budget ?? null,
  requested_budget: c.requested_budget ?? null,
  category: null,
  selected_categories: (c.targeting ?? []).map(toChipLabel),
  selected_zones: (c.zones ?? []).map((z) => z.name),
  validated_impressions: c.delivered_impressions ?? null,
  planned_impressions: c.planned_impressions ?? null,
});

interface UseLastCampaignsResult {
  campaigns: LastCampaign[];
  loading: boolean;
  error: Error | null;
}

export function useLastCampaigns(userId: string | undefined, limit = 5): UseLastCampaignsResult {
  const query = useQuery({
    queryKey: campaignsKeys.list(userId ?? ''),
    queryFn: () => campaignsApi.mine(),
    enabled: !!userId,
  });

  const campaigns = useMemo(
    () => (query.data ?? []).slice(0, limit).map(toLastCampaign),
    [query.data, limit],
  );

  return {
    campaigns,
    loading: query.isLoading,
    error: query.error,
  };
}
