import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  type EventMatchDecision,
  type PendingEventMatch,
  screenhostEventMatchesApi,
} from '@/features/screenhost/services/screenhost-event-matches.service';

import { screenhostKeys } from './queryKeys';

/**
 * Mariem 05/11 — the owner's matches awaiting a « Soir de match » answer, and the one answer
 * for every spot of a match at a venue. A decision refreshes the matches, the per-share proposals
 * and the bell (whose « À traiter » list keys on them).
 */
export function useScreenhostEventMatches(userId: string | undefined): {
  matches: PendingEventMatch[];
  loading: boolean;
  isError: boolean;
  decide: (
    eventId: string,
    screenhostId: string,
    answer: 'accept' | 'refuse',
  ) => Promise<EventMatchDecision>;
  deciding: boolean;
} {
  const queryClient = useQueryClient();
  const id = userId ?? '';
  const query = useQuery({
    queryKey: screenhostKeys.eventMatches(id),
    queryFn: () => screenhostEventMatchesApi.pending(),
    enabled: Boolean(userId),
  });

  const mutation = useMutation({
    mutationFn: (input: { eventId: string; screenhostId: string; answer: 'accept' | 'refuse' }) =>
      input.answer === 'accept'
        ? screenhostEventMatchesApi.accept(input.eventId, input.screenhostId)
        : screenhostEventMatchesApi.refuse(input.eventId, input.screenhostId),
    onSuccess: () => {
      for (const queryKey of [
        screenhostKeys.eventMatches(id),
        [...screenhostKeys.all, 'eventAllocations', id],
        screenhostKeys.notifications(id),
        screenhostKeys.campaigns(id),
      ]) {
        void queryClient.invalidateQueries({ queryKey });
      }
    },
  });

  return {
    matches: query.data ?? [],
    loading: query.isLoading,
    isError: query.isError,
    decide: (eventId, screenhostId, answer) =>
      mutation.mutateAsync({ eventId, screenhostId, answer }),
    deciding: mutation.isPending,
  };
}
