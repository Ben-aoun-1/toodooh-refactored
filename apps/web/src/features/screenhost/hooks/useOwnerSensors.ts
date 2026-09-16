import { useQuery } from '@tanstack/react-query';

import { ownerSensorsService } from '@/features/screenhost/services/owner-sensors.service';

import { screenhostKeys } from './queryKeys';

/** CAL-2 — sensor state per venue; polled like the screens (a sensor going silent shows up). */
export function useOwnerSensors(userId: string | undefined) {
  return useQuery({
    queryKey: screenhostKeys.sensors(userId ?? ''),
    queryFn: () => ownerSensorsService.list(),
    enabled: !!userId,
    refetchOnWindowFocus: 'always',
    refetchInterval: 60_000,
  });
}
