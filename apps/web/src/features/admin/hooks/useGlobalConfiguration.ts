import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  globalConfigurationService,
  type GlobalConfigurationRow,
} from '@/services/global-configuration.service';

import { adminKeys } from './queryKeys';

/**
 * The global DOOH-configuration rows. `globalConfigurationService` is a root
 * cross-cutting service; admin is its only React Query consumer, so the hook
 * lands under `features/admin/hooks/` (D6 — feature with the consumer).
 */
export function useGlobalConfiguration(): {
  rows: GlobalConfigurationRow[];
  loading: boolean;
  isError: boolean;
  error: Error | null;
} {
  const query = useQuery({
    queryKey: adminKeys.globalConfiguration(),
    queryFn: () => globalConfigurationService.list(),
  });
  return {
    rows: query.data ?? [],
    loading: query.isLoading,
    isError: query.isError,
    error: query.error,
  };
}

interface UpdateConfigurationInput {
  key: string;
  valueText: string;
}

/**
 * Updates one configuration row. `AdminGlobalConfiguration`'s save handler
 * calls this once per changed row; `onSuccess` invalidates the config query.
 */
export function useUpdateConfiguration() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ key, valueText }: UpdateConfigurationInput) =>
      globalConfigurationService.updateValue(key, valueText),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminKeys.globalConfiguration() });
    },
  });
}
