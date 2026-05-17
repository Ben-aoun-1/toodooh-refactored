import { useQuery } from '@tanstack/react-query';

import { authService } from '@/features/auth/services/auth.service';

import { authKeys } from './queryKeys';

/**
 * Owner-side business-sector reference list. Session-static — `staleTime` /
 * `gcTime` are `Infinity`, so it is fetched once per session and never
 * refetched (mirrors `useSectors`). Consumed by `OwnerSettings`.
 */
export function useOwnerBusinessSectors() {
  return useQuery({
    queryKey: authKeys.ownerBusinessSectors(),
    queryFn: () => authService.getOwnerBusinessSectors(),
    staleTime: Infinity,
    gcTime: Infinity,
  });
}
