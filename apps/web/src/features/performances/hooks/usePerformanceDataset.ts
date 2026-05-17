import { useQuery } from '@tanstack/react-query';

import { performanceService } from '@/features/performances/services/performance.service';
import type {
  PerformanceDataset,
  PerformanceFilters,
} from '@/features/performances/types/performance';
import { logger } from '@/lib/logger';
import { supabase } from '@/lib/supabase';

import { performancesKeys } from './queryKeys';

const log = logger.child({ module: 'usePerformanceDataset' });

interface UsePerformanceDatasetResult {
  dataset: PerformanceDataset | undefined;
  /** True on the initial fetch and on every manual `refetch()` — drives the page spinner. */
  loading: boolean;
  isError: boolean;
  refetch: () => void;
}

/**
 * Resolves the owner's campaign scope — every campaign linked to one of the
 * owner's locations or screens, plus campaigns the owner was directly asked
 * to approve. Verbatim port of `OwnerPerformance`'s former `loadOwnerScope`
 * effect (the 5-table filter context: `locations`, `screens`,
 * `campaign_owner_approvals`, `campaign_locations`, `campaign_screens`).
 */
async function fetchOwnerCampaignIds(userId: string): Promise<string[]> {
  const [{ data: ownerLocations }, { data: ownerScreens }, { data: ownerApprovals }] =
    await Promise.all([
      supabase.from('locations').select('id').eq('owner_id', userId),
      supabase.from('screens').select('id').eq('owner_id', userId),
      supabase.from('campaign_owner_approvals').select('campaign_id').eq('owner_id', userId),
    ]);

  const locationIds = (ownerLocations || []).map((r: { id: string }) => r.id);
  const screenIds = (ownerScreens || []).map((r: { id: string }) => r.id);
  const [ownerCampaignLocRes, ownerCampaignScreenRes] = await Promise.all([
    locationIds.length
      ? supabase.from('campaign_locations').select('campaign_id').in('location_id', locationIds)
      : Promise.resolve({ data: [], error: null }),
    screenIds.length
      ? supabase.from('campaign_screens').select('campaign_id').in('screen_id', screenIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  return Array.from(
    new Set(
      [
        ...((ownerCampaignLocRes.data || []) as Array<{ campaign_id: string }>).map(
          (r) => r.campaign_id,
        ),
        ...((ownerCampaignScreenRes.data || []) as Array<{ campaign_id: string }>).map(
          (r) => r.campaign_id,
        ),
        ...((ownerApprovals || []) as Array<{ campaign_id: string }>).map((r) => r.campaign_id),
      ].filter(Boolean),
    ),
  );
}

async function fetchPerformanceDataset(
  userId: string,
  filters: PerformanceFilters,
): Promise<PerformanceDataset> {
  const campaignIds = await fetchOwnerCampaignIds(userId);
  try {
    return await performanceService.getDataset(filters, { campaignIds });
  } catch (e) {
    log.error({ err: e }, 'failed to load owner performance dataset');
    throw e;
  }
}

/**
 * Composite read for `OwnerPerformance`: resolves the owner's campaign scope,
 * then runs `performanceService.getDataset` against it.
 *
 * `filters` is intentionally NOT part of the query key — matching the page's
 * pre-React-Query behaviour, where editing a filter does not refetch; only
 * the explicit "Actualiser" button does. The button calls the returned
 * `refetch()`, which re-runs the query with the latest `filters` closure.
 */
export function usePerformanceDataset(
  userId: string | undefined,
  filters: PerformanceFilters,
): UsePerformanceDatasetResult {
  const query = useQuery({
    queryKey: performancesKeys.dataset(userId ?? ''),
    queryFn: () => fetchPerformanceDataset(userId as string, filters),
    enabled: !!userId,
  });

  return {
    dataset: query.data,
    loading: query.isFetching,
    isError: query.isError,
    refetch: () => {
      void query.refetch();
    },
  };
}
