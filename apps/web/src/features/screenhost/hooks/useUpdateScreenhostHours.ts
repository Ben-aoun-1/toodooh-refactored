import { useMutation, useQueryClient } from '@tanstack/react-query';

import { type HoursPatch, screenhostService } from '../services/screenhost.service';

import { screenhostKeys } from './queryKeys';

interface UpdateScreenhostHoursInput {
  /** The owner whose `/mine` list is refreshed on success (key scoping). */
  userId: string;
  screenhostId: string;
  hours: HoursPatch;
}

/**
 * H2 — PATCH a screenhost's opening hours (the full pair, or both-null to clear), then refresh
 * the owner's `/mine` list so the Horaires editor re-renders its current state (the same list
 * the WiFi editor uses).
 */
export function useUpdateScreenhostHours() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ screenhostId, hours }: UpdateScreenhostHoursInput) =>
      screenhostService.updateHours(screenhostId, hours),
    onSuccess: (_data, { userId }) => {
      void queryClient.invalidateQueries({ queryKey: screenhostKeys.screenhostsMine(userId) });
    },
  });
}
