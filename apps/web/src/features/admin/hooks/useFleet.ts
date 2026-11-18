import { useQuery } from '@tanstack/react-query';

import { adminFleetService } from '@/features/admin/services/admin-fleet.service';

import { adminKeys } from './queryKeys';

/** FLEET-1 — refreshed every 30 s: a TV sends a heartbeat every 30 s. */
export const FLEET_REFRESH_MS = 30_000;

export function useFleet() {
  return useQuery({
    queryKey: adminKeys.fleet(),
    queryFn: () => adminFleetService.list(),
    refetchInterval: FLEET_REFRESH_MS,
  });
}

export function useFleetScreen(screenId: string | null) {
  return useQuery({
    queryKey: adminKeys.fleetScreen(screenId ?? ''),
    queryFn: () => adminFleetService.screen(screenId ?? ''),
    enabled: screenId !== null,
    refetchInterval: FLEET_REFRESH_MS,
  });
}
