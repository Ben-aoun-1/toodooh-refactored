import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

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

/** FLEET-2 — the remote actions; the panel refreshes a few seconds later to show the answer. */
export function useFleetRemote(screenId: string) {
  const queryClient = useQueryClient();
  const refresh = () => {
    setTimeout(() => {
      void queryClient.invalidateQueries({ queryKey: adminKeys.fleetScreen(screenId) });
    }, 3000);
  };
  return {
    restart: useMutation({
      mutationFn: () => adminFleetService.restart(screenId),
      onSuccess: refresh,
    }),
    requestStatus: useMutation({
      mutationFn: () => adminFleetService.requestStatus(screenId),
      onSuccess: refresh,
    }),
  };
}
