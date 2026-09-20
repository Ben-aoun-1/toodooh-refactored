import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  adminScreencasterCpmService,
  type ScreencasterCpmPatch,
  type ScreencasterCpmRow,
} from '@/features/admin/services/admin-screencaster-cpm.service';

import { adminKeys } from './queryKeys';

/** CPM-3 — every screencaster with its CPMs. */
export function useScreencasterCpmList(): {
  rows: ScreencasterCpmRow[];
  loading: boolean;
  isError: boolean;
  refetch: () => void;
} {
  const query = useQuery({
    queryKey: adminKeys.screencasterCpm(),
    queryFn: () => adminScreencasterCpmService.list(),
  });
  return {
    rows: query.data?.screencasters ?? [],
    loading: query.isLoading,
    isError: query.isError,
    refetch: () => {
      void query.refetch();
    },
  };
}

/** CPM-3 — change the CPM of the selected screencasters; the list is re-read afterwards. */
export function useUpdateScreencasterCpm() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: ScreencasterCpmPatch) => adminScreencasterCpmService.update(body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: adminKeys.screencasterCpm() });
    },
  });
}
