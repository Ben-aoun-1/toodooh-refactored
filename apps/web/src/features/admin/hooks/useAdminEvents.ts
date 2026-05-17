import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { adminEventsService } from '@/features/admin/services/admin-events.service';
import { advertiserKeys } from '@/features/advertiser/hooks/queryKeys';
import { eventsKeys } from '@/features/events/hooks/queryKeys';
import type { CreateEventDTO, EventStats, SpecialEvent } from '@/features/events/types/event';

import { adminKeys } from './queryKeys';

/** The full special-event list (filtering + pagination are client-side in the page). */
export function useAdminEvents(): { events: SpecialEvent[]; loading: boolean; isError: boolean } {
  const query = useQuery({
    queryKey: adminKeys.events(),
    queryFn: () => adminEventsService.getEvents(),
  });
  return {
    events: query.data ?? [],
    loading: query.isLoading,
    isError: query.isError,
  };
}

/** Event counters for the stat cards. */
export function useAdminEventStats(): { stats: EventStats | undefined } {
  const query = useQuery({
    queryKey: adminKeys.eventStats(),
    queryFn: () => adminEventsService.getStats(),
  });
  return { stats: query.data };
}

interface CreateEventInput {
  eventData: CreateEventDTO;
  adminId: string;
}

interface UpdateEventInput {
  eventId: string;
  eventData: Partial<CreateEventDTO>;
}

interface ToggleFeaturedInput {
  eventId: string;
  isFeatured: boolean;
}

/**
 * Event write mutations. The service methods return a truthy result on success
 * (`SpecialEvent | null` for create, `boolean` for the rest), so `onSuccess`
 * invalidates only when the write actually landed.
 *
 * CF-14 invalidation graph:
 * - (a) `adminKeys.events()` + `eventStats()` — the admin's own list / counters,
 *   in this session.
 * - (b) `eventsKeys.all` + `advertiserKeys` `featuredEvents` — the
 *   advertiser-visible events list and featured carousel. Cross-session (admin
 *   ≠ advertiser): a no-op in this QueryClient, kept for intent + hybrid-session
 *   defence; actual advertiser freshness rides their own staleTime.
 */
export function useAdminEventMutations() {
  const queryClient = useQueryClient();

  const invalidateEventViews = () => {
    queryClient.invalidateQueries({ queryKey: adminKeys.events() });
    queryClient.invalidateQueries({ queryKey: adminKeys.eventStats() });
    queryClient.invalidateQueries({ queryKey: eventsKeys.all });
    queryClient.invalidateQueries({ queryKey: [...advertiserKeys.all, 'featuredEvents'] });
  };
  const invalidateIfLanded = (result: unknown) => {
    if (result) invalidateEventViews();
  };

  const createEvent = useMutation({
    mutationFn: ({ eventData, adminId }: CreateEventInput) =>
      adminEventsService.createEvent(eventData, adminId),
    onSuccess: invalidateIfLanded,
  });

  const updateEvent = useMutation({
    mutationFn: ({ eventId, eventData }: UpdateEventInput) =>
      adminEventsService.updateEvent(eventId, eventData),
    onSuccess: invalidateIfLanded,
  });

  const deleteEvent = useMutation({
    mutationFn: (eventId: string) => adminEventsService.deleteEvent(eventId),
    onSuccess: invalidateIfLanded,
  });

  const toggleFeatured = useMutation({
    mutationFn: ({ eventId, isFeatured }: ToggleFeaturedInput) =>
      adminEventsService.toggleFeatured(eventId, isFeatured),
    onSuccess: invalidateIfLanded,
  });

  return { createEvent, updateEvent, deleteEvent, toggleFeatured };
}
