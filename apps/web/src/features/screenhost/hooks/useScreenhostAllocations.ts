import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  type PendingAllocation,
  screenhostAllocationsService,
} from '@/features/screenhost/services/screenhost-allocations.service';

import { screenhostKeys } from './queryKeys';

/**
 * The owner's pending dispatch-allocation accept/reject surface (de-Supabased replacement for the
 * legacy campaign-owner-approval flow). One `useQuery` for the EN_ATTENTE list + two mutations
 * (accept / reject) that invalidate-and-refetch the list and the owner notification bell (the
 * producer's "pending acceptance" notification becomes moot once the owner decides).
 */
export function useScreenhostAllocations(userId: string | undefined): {
  allocations: PendingAllocation[];
  loading: boolean;
  isError: boolean;
  refetch: () => void;
  accept: (id: string) => Promise<void>;
  reject: (id: string) => Promise<void>;
  deciding: boolean;
} {
  const queryClient = useQueryClient();
  const listKey = screenhostKeys.pendingAllocations(userId ?? '');

  const query = useQuery({
    queryKey: listKey,
    queryFn: () => screenhostAllocationsService.listPending(),
    enabled: Boolean(userId),
  });

  const invalidate = () => {
    // The list (this decision removes the allocation from EN_ATTENTE) + the bell (the pending-
    // acceptance notification is now actioned).
    queryClient.invalidateQueries({ queryKey: listKey });
    queryClient.invalidateQueries({ queryKey: screenhostKeys.notifications(userId ?? '') });
  };

  const acceptMutation = useMutation({
    mutationFn: (id: string) => screenhostAllocationsService.accept(id),
    onSuccess: invalidate,
  });
  const rejectMutation = useMutation({
    mutationFn: (id: string) => screenhostAllocationsService.reject(id),
    onSuccess: invalidate,
  });

  return {
    allocations: query.data ?? [],
    loading: query.isLoading,
    isError: query.isError,
    refetch: () => {
      void query.refetch();
    },
    accept: async (id: string) => {
      await acceptMutation.mutateAsync(id);
    },
    reject: async (id: string) => {
      await rejectMutation.mutateAsync(id);
    },
    deciding: acceptMutation.isPending || rejectMutation.isPending,
  };
}
