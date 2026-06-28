import { useQuery } from '@tanstack/react-query';

import {
  type AcceptedAllocation,
  screenhostCalendarService,
} from '@/features/screenhost/services/screenhost-calendar.service';

import { screenhostKeys } from './queryKeys';

/**
 * The owner's diffusion calendar: the ACCEPTE allocations (campaigns that air on their screenhosts)
 * + their créneaux, from `GET /api/screenhosts/calendar`. Read-only — acceptance happens on the
 * separate accept/reject surface; this is purely the "what's scheduled" view.
 */
export function useScreenhostCalendar(userId: string | undefined): {
  allocations: AcceptedAllocation[];
  loading: boolean;
  isError: boolean;
  refetch: () => void;
} {
  const query = useQuery({
    queryKey: screenhostKeys.calendar(userId ?? ''),
    queryFn: () => screenhostCalendarService.list(),
    enabled: Boolean(userId),
  });

  return {
    allocations: query.data ?? [],
    loading: query.isLoading,
    isError: query.isError,
    refetch: () => {
      void query.refetch();
    },
  };
}
