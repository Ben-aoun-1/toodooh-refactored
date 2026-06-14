import { useMutation, useQueryClient } from '@tanstack/react-query';

import { adminScreenhostService } from '@/features/admin/services/admin-screenhost.service';
import type { WifiPatch } from '@/features/screenhost/services/screenhost.service';

import { adminKeys } from './queryKeys';

interface AdminUpdateWifiInput {
  screenhostId: string;
  wifi: WifiPatch;
}

/**
 * Admin WiFi edit of any screenhost. On success, invalidate the `['admin','users']` prefix so the
 * moderation list (which now carries each user's screenhosts) refetches and the modal's
 * wifi_password_set + SSID reflect the change.
 */
export function useAdminUpdateScreenhostWifi() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ screenhostId, wifi }: AdminUpdateWifiInput) =>
      adminScreenhostService.updateWifi(screenhostId, wifi),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: adminKeys.users() });
    },
  });
}
