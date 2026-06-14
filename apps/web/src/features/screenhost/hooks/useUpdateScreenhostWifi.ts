import { useMutation, useQueryClient } from '@tanstack/react-query';

import { screenhostService, type WifiPatch } from '../services/screenhost.service';

import { screenhostKeys } from './queryKeys';

interface UpdateScreenhostWifiInput {
  /** The owner whose `/mine` list is refreshed on success (key scoping). */
  userId: string;
  screenhostId: string;
  wifi: WifiPatch;
}

/**
 * PATCH a screenhost's WiFi, then refresh the owner's `/mine` list so the
 * SSID + `wifi_password_set` flag re-render. The backend fire-and-forgets the
 * wedooh re-push; nothing here waits on it.
 */
export function useUpdateScreenhostWifi() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ screenhostId, wifi }: UpdateScreenhostWifiInput) =>
      screenhostService.updateWifi(screenhostId, wifi),
    onSuccess: (_data, { userId }) => {
      void queryClient.invalidateQueries({ queryKey: screenhostKeys.screenhostsMine(userId) });
    },
  });
}
