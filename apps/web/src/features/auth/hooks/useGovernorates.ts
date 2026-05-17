import { useQuery } from '@tanstack/react-query';

import { authService } from '@/features/auth/services/auth.service';

import { authKeys } from './queryKeys';

/**
 * Governorate reference list. Session-static — see `useSectors` for the
 * `staleTime`/`gcTime: Infinity` rationale.
 */
export function useGovernorates() {
  return useQuery({
    queryKey: authKeys.governorates(),
    queryFn: () => authService.getGovernorates(),
    staleTime: Infinity,
    gcTime: Infinity,
  });
}
