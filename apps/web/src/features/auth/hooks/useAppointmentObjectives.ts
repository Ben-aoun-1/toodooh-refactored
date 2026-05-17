import { useQuery } from '@tanstack/react-query';

import { authService } from '@/features/auth/services/auth.service';

import { authKeys } from './queryKeys';

/**
 * Support-appointment objective options. Session-static reference data —
 * `staleTime` / `gcTime` are `Infinity` (mirrors `useSectors`). Consumed by
 * `OwnerNavigation`'s support modal, which falls back to a local constant
 * list when the query returns empty.
 */
export function useAppointmentObjectives() {
  return useQuery({
    queryKey: authKeys.appointmentObjectives(),
    queryFn: () => authService.getAppointmentObjectives(),
    staleTime: Infinity,
    gcTime: Infinity,
  });
}
