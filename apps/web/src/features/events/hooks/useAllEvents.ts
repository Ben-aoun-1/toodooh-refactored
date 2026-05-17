import { useQuery } from '@tanstack/react-query';

import { eventsService } from '@/features/events/services/events.service';
import type { SpecialEvent } from '@/features/events/types/event';

import { eventsKeys } from './queryKeys';

// The page fetches one large batch and paginates client-side.
const FETCH_SIZE = 500;

interface UseAllEventsResult {
  events: SpecialEvent[];
  loading: boolean;
}

/** The full advertiser-facing event list (fetched once, paginated in the page). */
export function useAllEvents(): UseAllEventsResult {
  const query = useQuery({
    queryKey: eventsKeys.list(),
    queryFn: () => eventsService.getAllEvents(1, FETCH_SIZE),
  });

  return {
    events: query.data?.events ?? [],
    loading: query.isLoading,
  };
}
