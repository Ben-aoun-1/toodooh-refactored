import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  adminHostService,
  type HostLockKey,
  type HostOwnerPatch,
  type HostUnavailability,
  type HostVenuePatch,
} from '@/features/admin/services/admin-host.service';
import { applyOptimisticToggle } from '@/features/screenhost/hooks/useScreenhostUnavailability';

import { adminKeys } from './queryKeys';

// HOST-EDIT1 — the « Fiche Host » reads and writes. Every successful admin write of a venue
// refetches its fiche (the hub locks move), its trail, and the two listings that show its fields.

export const invalidateHostFiche = (queryClient: QueryClient, screenhostId: string): void => {
  void queryClient.invalidateQueries({ queryKey: adminKeys.hostFiche(screenhostId) });
  void queryClient.invalidateQueries({ queryKey: adminKeys.hostHistory(screenhostId) });
  void queryClient.invalidateQueries({ queryKey: adminKeys.adminLocationsAll() });
  void queryClient.invalidateQueries({ queryKey: adminKeys.users() });
};

export function useHostFiche(screenhostId: string | undefined) {
  return useQuery({
    queryKey: adminKeys.hostFiche(screenhostId ?? ''),
    queryFn: () => adminHostService.get(screenhostId ?? ''),
    enabled: Boolean(screenhostId),
  });
}

export function useHostHistory(screenhostId: string) {
  return useQuery({
    queryKey: adminKeys.hostHistory(screenhostId),
    queryFn: () => adminHostService.history(screenhostId),
  });
}

export function useUpdateHostVenue(screenhostId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: HostVenuePatch) => adminHostService.updateVenue(screenhostId, patch),
    onSuccess: () => invalidateHostFiche(queryClient, screenhostId),
  });
}

export function useUpdateHostOwner(screenhostId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: HostOwnerPatch) => adminHostService.updateOwner(screenhostId, patch),
    onSuccess: () => invalidateHostFiche(queryClient, screenhostId),
  });
}

export function useUnlockHostField(screenhostId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (field: HostLockKey) => adminHostService.unlock(screenhostId, field),
    onSuccess: () => invalidateHostFiche(queryClient, screenhostId),
  });
}

export function useHostUnavailability(screenhostId: string, from: string, to: string) {
  return useQuery({
    queryKey: adminKeys.hostUnavailability(screenhostId, from, to),
    queryFn: () => adminHostService.unavailability(screenhostId, from, to),
    enabled: from !== '' && to !== '',
  });
}

/** The owner calendar's optimistic toggle (useToggleUnavailability), on the admin twin route. */
export function useToggleHostDay(screenhostId: string, from: string, to: string) {
  const queryClient = useQueryClient();
  const key = adminKeys.hostUnavailability(screenhostId, from, to);
  return useMutation({
    mutationFn: ({ day, unavailable }: { day: string; unavailable: boolean }) =>
      adminHostService.toggleDay(screenhostId, day, unavailable),
    onMutate: async ({ day, unavailable }) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<HostUnavailability>(key);
      if (previous) {
        queryClient.setQueryData<HostUnavailability>(key, {
          ...previous,
          days: applyOptimisticToggle(previous.days, day, unavailable),
        });
      }
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous !== undefined) queryClient.setQueryData(key, context.previous);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: key });
      void queryClient.invalidateQueries({ queryKey: adminKeys.hostHistory(screenhostId) });
    },
  });
}
