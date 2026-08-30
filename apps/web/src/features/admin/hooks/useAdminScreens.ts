import { useQuery } from '@tanstack/react-query';

import {
  adminScreensService,
  type AdminLocationStatus,
} from '@/features/admin/services/admin-screens.service';

import { adminKeys } from './queryKeys';

export interface AdminLocationFilters {
  status: 'all' | AdminLocationStatus;
  ownerId: string;
  search: string;
  page: number;
  perPage: number;
}

/** Paginated, filtered venue list for ScreenManagement. Filters live in the key. */
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
      adminScreensService.list({
        status: filters.status !== 'all' ? filters.status : undefined,
        owner_id: filters.ownerId !== 'all' ? filters.ownerId : undefined,
        search: filters.search || undefined,
        page: filters.page,
        per_page: filters.perPage,
      }),
  });
  const total = query.data?.total ?? 0;
  return {
    locations: query.data?.locations ?? [],
    total,
    totalPages: Math.max(1, Math.ceil(total / filters.perPage)),
    loading: query.isLoading,
    isError: query.isError,
  };
}

/** The owner picker for ScreenManagement's owner filter. */
export function useScreenOwners() {
  const query = useQuery({
    queryKey: adminKeys.screenOwners(),
    queryFn: () => adminScreensService.owners(),
    staleTime: Infinity,
    gcTime: Infinity,
  });
  return { owners: query.data ?? [], isError: query.isError };
}
