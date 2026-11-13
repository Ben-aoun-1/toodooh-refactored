import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  type UnavailabilityView,
  applyHoursToggle,
} from '@/features/screenhost/lib/hour-unavailability';
import { screenhostUnavailabilityService } from '@/features/screenhost/services/screenhost-unavailability.service';

import { screenhostKeys } from './queryKeys';

// E2 → HOUR-UNAV1 — the calendar's read + the OPTIMISTIC toggle: the hours flip in the grid at
// once, and a refused write (PAST_OR_TODAY, network) rolls the cache back and surfaces the error to
// the caller's onError (the page toasts in French).

const unavailabilityKey = screenhostKeys.unavailability;

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

export interface HoursToggle {
  day: string;
  unavailable: boolean;
  /** Some hours of the opening day; absent = the whole day. */
  hours?: number[];
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
    mutationFn: ({ day, unavailable, hours }: HoursToggle) =>
      screenhostUnavailabilityService.toggle(screenhostId ?? '', day, unavailable, hours),
    onMutate: async ({ day, unavailable, hours }) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<UnavailabilityView>(key);
      if (previous) {
        queryClient.setQueryData<UnavailabilityView>(
          key,
          applyHoursToggle(previous, day, hours ?? null, unavailable),
        );
      }
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
