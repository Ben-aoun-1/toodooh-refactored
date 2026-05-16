import { useQuery } from '@tanstack/react-query';

import { eventsService } from '@/features/events/services/events.service';
import type { SpecialEvent } from '@/features/events/types/event';

import { advertiserKeys } from './queryKeys';

interface UseFeaturedEventsResult {
  events: SpecialEvent[];
  loading: boolean;
  error: Error | null;
}

export function useFeaturedEvents(limit = 3): UseFeaturedEventsResult {
  const query = useQuery({
    queryKey: advertiserKeys.featuredEvents(limit),
    queryFn: () => eventsService.getFeaturedEvents(limit),
  });

  return {
    events: query.data ?? [],
    loading: query.isLoading,
    error: query.error,
  };
}
