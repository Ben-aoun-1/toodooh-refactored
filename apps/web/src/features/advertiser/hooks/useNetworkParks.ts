import { useQuery } from '@tanstack/react-query';

import { parksService } from '../services/parks.service';

import { advertiserKeys } from './queryKeys';

/** The TV parks of the network (GET /api/network/parks), for the dashboard's parks section. */
export function useNetworkParks() {
  return useQuery({
    queryKey: advertiserKeys.networkParks(),
    queryFn: () => parksService.list(),
    select: (d) => d.parks,
  });
}
