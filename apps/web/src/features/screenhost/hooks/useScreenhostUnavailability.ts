import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { screenhostUnavailabilityService } from '@/features/screenhost/services/screenhost-unavailability.service';

import { screenhostKeys } from './queryKeys';

// E2 — the calendar's read + the OPTIMISTIC toggle: the day flips in the grid immediately, and a
// refused write (PAST_OR_TODAY, network) rolls the cache back and surfaces the error to the
// caller's onError (the page toasts in French).

const unavailabilityKey = screenhostKeys.unavailability;

/** The optimistic cache step, pure: declare inserts (deduped, sorted); undeclare removes. */
export const applyOptimisticToggle = (
  days: readonly string[],
  day: string,
  unavailable: boolean,
): string[] => (unavailable ? [...new Set([...days, day])].sort() : days.filter((d) => d !== day));

export function useScreenhostUnavailability(
  screenhostId: string | undefined,
  from: string,
  to: string,
) {
  return useQuery({
    queryKey: unavailabilityKey(screenhostId ?? '', from, to),
    queryFn: () => screenhostUnavailabilityService.list(screenhostId ?? '', from, to),
    enabled: Boolean(screenhostId),
  });
}

export function useToggleUnavailability(
  screenhostId: string | undefined,
  from: string,
  to: string,
  userId?: string,
) {
  const queryClient = useQueryClient();
  const key = unavailabilityKey(screenhostId ?? '', from, to);
  return useMutation({
    mutationFn: ({ day, unavailable }: { day: string; unavailable: boolean }) =>
      screenhostUnavailabilityService.toggle(screenhostId ?? '', day, unavailable),
    onMutate: async ({ day, unavailable }) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<string[]>(key);
      queryClient.setQueryData<string[]>(key, (days = []) =>
        applyOptimisticToggle(days, day, unavailable),
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous !== undefined) queryClient.setQueryData(key, context.previous);
    },
    // CAL-1 — a declaration that moved a share changed the diffusion layer, the pending queue
    // (the re-placed venues must re-accept) and possibly this owner's bell.
    onSuccess: (result) => {
      if (result.redispatched.length > 0 && userId) {
        void queryClient.invalidateQueries({ queryKey: screenhostKeys.calendar(userId) });
        void queryClient.invalidateQueries({ queryKey: screenhostKeys.pendingAllocations(userId) });
        void queryClient.invalidateQueries({ queryKey: screenhostKeys.notifications(userId) });
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: key });
    },
  });
}
