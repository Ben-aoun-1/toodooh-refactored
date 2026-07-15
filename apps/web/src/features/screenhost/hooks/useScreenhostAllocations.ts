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

  const invalidateBell = () => {
    // The producer's "pending acceptance" notification is moot once the owner decides.
    queryClient.invalidateQueries({ queryKey: screenhostKeys.notifications(userId ?? '') });
  };

  const acceptMutation = useMutation({
    mutationFn: (id: string) => screenhostAllocationsService.accept(id),
    onSuccess: () => {
      // Accept removes the allocation from EN_ATTENTE — refetch so the card leaves the queue.
      queryClient.invalidateQueries({ queryKey: listKey });
      invalidateBell();
    },
  });
  const rejectMutation = useMutation({
    mutationFn: (id: string) => screenhostAllocationsService.reject(id),
    // CF-O1 — deliberately NO list invalidation: the refused card must stay visible in its
    // « Refus enregistré » state (page-held copy) instead of vanishing on refetch.
    onSuccess: invalidateBell,
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

/**
 * CF-O1 — the allocation's short-TTL presigned spot url, fetched lazily: `enabled` only once the
 * owner expands « Voir le spot » (a list of always-presigned urls would go stale, the TTL is 5min).
 * staleTime under the TTL so an expand → collapse → expand within the window reuses the same url.
 */
export function useAllocationCreativeUrl(
  allocationId: string,
  enabled: boolean,
): { url: string | undefined; isLoading: boolean; isError: boolean } {
  const query = useQuery({
    queryKey: screenhostKeys.allocationCreativeUrl(allocationId),
    queryFn: () => screenhostAllocationsService.creativeUrl(allocationId),
    enabled,
    staleTime: 4 * 60 * 1000,
  });
  return { url: query.data?.url, isLoading: query.isLoading, isError: query.isError };
}
