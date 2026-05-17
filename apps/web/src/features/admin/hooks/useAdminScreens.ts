import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  adminScreensService,
  type AdminLocationStatus,
} from '@/features/admin/services/admin-screens.service';
import { supabase } from '@/lib/supabase';

import { adminKeys } from './queryKeys';

export interface AdminLocationFilters {
  status: 'all' | AdminLocationStatus;
  ownerId: string;
  search: string;
  page: number;
  perPage: number;
}

/** Paginated, filtered location list for ScreenManagement. Filters live in the key. */
export function useAdminLocations(filters: AdminLocationFilters) {
  const query = useQuery({
    queryKey: adminKeys.adminLocations(
      filters.status,
      filters.ownerId,
      filters.search,
      filters.page,
      filters.perPage,
    ),
    queryFn: () =>
      adminScreensService.getLocationsWithScreens(filters.page, filters.perPage, {
        status: filters.status !== 'all' ? filters.status : undefined,
        owner_id: filters.ownerId !== 'all' ? filters.ownerId : undefined,
        search: filters.search || undefined,
      }),
  });
  return {
    locations: query.data?.locations ?? [],
    total: query.data?.total ?? 0,
    totalPages: query.data?.totalPages ?? 1,
    loading: query.isLoading,
    isError: query.isError,
  };
}

/** The screen-owner picker for ScreenManagement's owner filter. */
export function useScreenOwners() {
  const query = useQuery({
    queryKey: adminKeys.screenOwners(),
    queryFn: () => adminScreensService.getOwners(),
    staleTime: Infinity,
    gcTime: Infinity,
  });
  return { owners: query.data ?? [], isError: query.isError };
}

interface AffluenceRow {
  location_id: string;
  day_of_week: number;
  hour: number;
  estimated_impressions: number;
}

/**
 * The stored hourly affluence rows for one location (`AffluenceModal`). The
 * modal merges these onto a 7×24 default grid for editing — `data` is returned
 * raw so that derive effect keys off a stable reference (CF-16).
 */
export function useAffluenceSchedule(locationId: string): {
  rows: AffluenceRow[] | undefined;
  loading: boolean;
  isError: boolean;
} {
  const query = useQuery({
    queryKey: adminKeys.affluenceSchedule(locationId),
    queryFn: async (): Promise<AffluenceRow[]> => {
      const { data, error } = await supabase
        .from('location_affluence_schedule')
        .select('location_id, day_of_week, hour, estimated_impressions')
        .eq('location_id', locationId)
        .order('day_of_week', { ascending: true })
        .order('hour', { ascending: true });
      if (error) throw error;
      // TODO(phase-1): typed source [supabase] — see #15
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (data ?? []).map((r: any) => ({
        location_id: locationId,
        day_of_week: Number(r.day_of_week),
        hour: Number(r.hour),
        estimated_impressions: Number(r.estimated_impressions) || 0,
      }));
    },
  });
  return { rows: query.data, loading: query.isLoading, isError: query.isError };
}

interface SaveAffluenceInput {
  locationId: string;
  rows: AffluenceRow[];
}

/** Upserts a location's full hourly affluence grid. */
export function useSaveAffluenceSchedule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ rows }: SaveAffluenceInput) => {
      if (rows.length > 0) {
        const { error } = await supabase
          .from('location_affluence_schedule')
          .upsert(rows, { onConflict: 'location_id,day_of_week,hour' });
        if (error) throw error;
      }
    },
    onSuccess: (_result, { locationId }) => {
      queryClient.invalidateQueries({ queryKey: adminKeys.affluenceSchedule(locationId) });
    },
  });
}
