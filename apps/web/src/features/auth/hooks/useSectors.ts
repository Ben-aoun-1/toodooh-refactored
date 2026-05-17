import { useQuery } from '@tanstack/react-query';

import { authService } from '@/features/auth/services/auth.service';

import { authKeys } from './queryKeys';

/**
 * Business-sector reference list. Session-static — `staleTime`/`gcTime` are
 * `Infinity` so it is fetched once per session and never refetched or
 * garbage-collected. A consumer needing fresh data (e.g. an admin editing
 * the canonical list) invalidates `authKeys.sectors()` explicitly.
 */
export function useSectors() {
  return useQuery({
    queryKey: authKeys.sectors(),
    queryFn: () => authService.getBusinessSectors(),
    staleTime: Infinity,
    gcTime: Infinity,
  });
}
