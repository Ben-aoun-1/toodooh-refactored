import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  adminDispatchConfigService,
  type CpmPatch,
  type DispatchConfigView,
} from '@/features/admin/services/admin-dispatch-config.service';

import { adminKeys } from './queryKeys';

/** The resolved dispatch config (read-only context + the editable CPMs). */
export function useDispatchConfig(): {
  config: DispatchConfigView | undefined;
  loading: boolean;
  isError: boolean;
  refetch: () => void;
} {
  const query = useQuery({
    queryKey: adminKeys.dispatchConfig(),
    queryFn: () => adminDispatchConfigService.get(),
  });
  return {
    config: query.data,
    loading: query.isLoading,
    isError: query.isError,
    refetch: () => {
      void query.refetch();
    },
  };
}

/**
 * Edit the admin-editable CPMs (standard/event). The PATCH returns the resolved
 * config, so prime the cache with the response and invalidate to re-sync.
 */
export function useUpdateCpmConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: CpmPatch) => adminDispatchConfigService.patchCpm(patch),
    onSuccess: (data) => {
      queryClient.setQueryData(adminKeys.dispatchConfig(), data);
      queryClient.invalidateQueries({ queryKey: adminKeys.dispatchConfig() });
    },
  });
}
