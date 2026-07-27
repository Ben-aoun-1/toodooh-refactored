import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  type UpsertEventInput,
  adminEventsService,
} from '@/features/admin/services/admin-events.service';
import { eventsKeys } from '@/features/events/hooks/queryKeys';

import { adminKeys } from './queryKeys';

// EV1 — every write invalidates BOTH the admin list and the advertiser-facing catalogue caches
// (an admin create/edit/annuler is immediately visible on /evenements in the same session).

const useInvalidateEvents = () => {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: adminKeys.events() });
    void queryClient.invalidateQueries({ queryKey: eventsKeys.all });
  };
};

/** The full event list (official + suggested + annulé; filtering is client-side). */
export function useAdminEvents() {
  const query = useQuery({
    queryKey: adminKeys.events(),
    queryFn: () => adminEventsService.list(),
    select: (d) => d.events,
  });
  return { events: query.data ?? [], loading: query.isLoading, isError: query.isError };
}

export function useCreateEvent() {
  const invalidate = useInvalidateEvents();
  return useMutation({
    mutationFn: (input: UpsertEventInput) => adminEventsService.create(input),
    onSuccess: invalidate,
  });
}

export function useUpdateEvent() {
  const invalidate = useInvalidateEvents();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpsertEventInput }) =>
      adminEventsService.update(id, patch),
    onSuccess: invalidate,
  });
}

export function useAnnulerEvent() {
  const invalidate = useInvalidateEvents();
  return useMutation({
    mutationFn: (id: string) => adminEventsService.annuler(id),
    onSuccess: invalidate,
  });
}

export function useUploadEventImage() {
  const invalidate = useInvalidateEvents();
  return useMutation({
    mutationFn: ({ id, file }: { id: string; file: File }) =>
      adminEventsService.uploadImage(id, file),
    onSuccess: invalidate,
  });
}

/** One event's presigned affiche URL (admin list thumbnails). */
export function useAdminEventImageUrl(id: string, hasImage: boolean) {
  return useQuery({
    queryKey: adminKeys.eventImageUrl(id),
    queryFn: () => adminEventsService.imageUrl(id),
    enabled: hasImage,
  });
}
