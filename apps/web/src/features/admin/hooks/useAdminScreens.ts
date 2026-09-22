import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { adminScreenhostService } from '@/features/admin/services/admin-screenhost.service';
import {
  adminScreensService,
  type AdminLocationStatus,
} from '@/features/admin/services/admin-screens.service';
import type { DeclarationPatch } from '@/features/screenhost/services/screenhost.service';

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

/**
 * SCR-DECL1 — the admin edit of a venue's declared screens / rooms. On success every venue-list
 * page refetches (the label and the rows may have moved), and so does the users list, whose
 * detail sums each owner's declared screens.
 */
export function useUpdateAdminScreenhostDeclaration() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ screenhostId, patch }: { screenhostId: string; patch: DeclarationPatch }) =>
      adminScreenhostService.updateDeclaration(screenhostId, patch),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: adminKeys.adminLocationsAll() });
      void queryClient.invalidateQueries({ queryKey: adminKeys.users() });
    },
  });
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
