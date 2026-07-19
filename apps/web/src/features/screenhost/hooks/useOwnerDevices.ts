import { useQuery } from '@tanstack/react-query';

import {
  type OwnerDeviceRow,
  ownerDevicesService,
} from '@/features/screenhost/services/owner-devices.service';

import { screenhostKeys } from './queryKeys';

interface UseOwnerDevicesResult {
  devices: OwnerDeviceRow[];
  loading: boolean;
  isError: boolean;
}

/**
 * CF-D1 — the owner's devices with real liveness (GET /api/screenhosts/screens). Liveness must
 * FEEL live: focus-refetch 'always' (the money-queries posture — the app-wide default is false)
 * plus a 60s poll (the notification-bell cadence), so a screen going dark surfaces within a
 * minute without any interaction.
 */
export function useOwnerDevices(userId: string | undefined): UseOwnerDevicesResult {
  const query = useQuery({
    queryKey: screenhostKeys.devices(userId ?? ''),
    queryFn: () => ownerDevicesService.list(),
    enabled: !!userId,
    refetchOnWindowFocus: 'always',
    refetchInterval: 60_000,
  });
  return {
    devices: query.data ?? [],
    loading: query.isLoading,
    isError: query.isError,
  };
}
