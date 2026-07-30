import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  type PendingEventAllocation,
  screenhostEventAllocationsApi,
} from '@/features/screenhost/services/screenhost-event-allocations.service';

import { screenhostKeys } from './queryKeys';

/**
 * EV4 — the owner's pending EVENT-allocation surface (§11.1), the campaign hook's sibling:
 * one EN_ATTENTE list + accept/refuse mutations. Accept refetches (the card leaves the queue)
 * and surfaces the API's antenne reminder; refuse deliberately keeps the card (the page holds
 * its « Refus enregistré » state — the campaign idiom, kept).
 */
export function useScreenhostEventAllocations(userId: string | undefined): {
  proposals: PendingEventAllocation[];
  loading: boolean;
  isError: boolean;
  accept: (id: string) => Promise<string | undefined>;
  refuse: (id: string) => Promise<void>;
  deciding: boolean;
} {
  const queryClient = useQueryClient();
  const listKey = [...screenhostKeys.all, 'eventAllocations', userId ?? ''] as const;

  const query = useQuery({
    queryKey: listKey,
    queryFn: () => screenhostEventAllocationsApi.pending(),
    enabled: Boolean(userId),
  });

  const invalidateBell = () => {
    queryClient.invalidateQueries({ queryKey: screenhostKeys.notifications(userId ?? '') });
  };

  const acceptMutation = useMutation({
    mutationFn: (id: string) => screenhostEventAllocationsApi.accept(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: listKey });
      invalidateBell();
    },
  });
  const refuseMutation = useMutation({
    mutationFn: (id: string) => screenhostEventAllocationsApi.refuse(id),
    onSuccess: invalidateBell,
  });

  return {
    proposals: query.data ?? [],
    loading: query.isLoading,
    isError: query.isError,
    accept: async (id: string) => (await acceptMutation.mutateAsync(id)).reminder,
    refuse: async (id: string) => {
      await refuseMutation.mutateAsync(id);
    },
    deciding: acceptMutation.isPending || refuseMutation.isPending,
  };
}

/** The proposal's short-TTL presigned spot url — fetched only once the owner expands the view. */
export function useEventAllocationCreativeUrl(
  allocationId: string,
  enabled: boolean,
): { url: string | undefined; isLoading: boolean; isError: boolean } {
  const query = useQuery({
    queryKey: [...screenhostKeys.all, 'eventAllocationCreativeUrl', allocationId] as const,
    queryFn: () => screenhostEventAllocationsApi.creativeUrl(allocationId),
    enabled,
    staleTime: 4 * 60 * 1000,
  });
  return { url: query.data?.url, isLoading: query.isLoading, isError: query.isError };
}
