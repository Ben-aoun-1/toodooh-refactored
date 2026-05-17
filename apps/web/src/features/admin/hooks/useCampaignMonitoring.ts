import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { adminCampaignMonitoringService } from '@/features/admin/services/admin-campaign-monitoring.service';
import { supabase } from '@/lib/supabase';

import { adminKeys } from './queryKeys';

/** The monitored-campaign list — drives the page spinner. */
export function useMonitoringCampaigns(enabled: boolean) {
  const query = useQuery({
    queryKey: adminKeys.monitoringCampaigns(),
    queryFn: () => adminCampaignMonitoringService.getCampaignsWithScreens(),
    enabled,
  });
  return {
    campaigns: query.data ?? [],
    loading: query.isLoading,
    isError: query.isError,
  };
}

/** Global monitoring stats — loaded in the background, never gates the page. */
export function useMonitoringGlobalStats(enabled: boolean) {
  const query = useQuery({
    queryKey: adminKeys.monitoringStats(),
    queryFn: () => adminCampaignMonitoringService.getGlobalStats(),
    enabled,
  });
  return { stats: query.data };
}

/** Per-category campaign breakdown — background load. */
export function useMonitoringCategories(enabled: boolean) {
  const query = useQuery({
    queryKey: adminKeys.monitoringCategories(),
    queryFn: () => adminCampaignMonitoringService.getCampaignsByCategory(),
    enabled,
  });
  return { categories: query.data ?? [] };
}

interface StopCampaignInput {
  campaignId: string;
  adminFullName: string;
  reason: string;
}

/**
 * Emergency campaign-stop mutation — verbatim port of `handleStopCampaign`'s
 * write: a `campaigns` status → `paused` update that retries without the
 * `validation_notes` column if the schema lacks it (PGRST204 fallback).
 *
 * Invalidation is intra-feature (the monitoring list + stats). The advertiser
 * / owner campaign views that would also change run in separate sessions —
 * not this QueryClient — so there is no cross-feature key to reach here.
 */
export function useStopCampaign() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ campaignId, adminFullName, reason }: StopCampaignInput) => {
      let { error } = await supabase
        .from('campaigns')
        .update({
          status: 'paused',
          validation_notes: `⚠️ ARRÊT D'URGENCE par ${adminFullName}\nRaison: ${reason}\nDate: ${new Date().toLocaleString('fr-FR')}`,
        })
        .eq('id', campaignId);

      if (error?.code === 'PGRST204' && String(error?.message || '').includes('validation_notes')) {
        const { error: fallbackError } = await supabase
          .from('campaigns')
          .update({ status: 'paused' })
          .eq('id', campaignId);
        error = fallbackError;
      }

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminKeys.monitoringCampaigns() });
      queryClient.invalidateQueries({ queryKey: adminKeys.monitoringStats() });
    },
  });
}
