import { useQuery } from '@tanstack/react-query';

import { screenhostService } from '../services/screenhost.service';

import { screenhostKeys } from './queryKeys';

/**
 * The caller's screenhosts with their WiFi state ({id, name, wifi_ssid,
 * wifi_password_set}). The password is never read — only its presence flag.
 * Disabled until a userId is known (the key is owner-scoped for invalidation).
 */
export function useScreenhostsMine(userId: string | undefined) {
  return useQuery({
    queryKey: screenhostKeys.screenhostsMine(userId ?? ''),
    queryFn: () => screenhostService.getMine(),
    enabled: Boolean(userId),
  });
}
