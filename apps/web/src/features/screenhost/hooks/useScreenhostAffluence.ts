import { useQuery } from '@tanstack/react-query';

import { screenhostService } from '../services/screenhost.service';

import { screenhostKeys } from './queryKeys';

/**
 * A screenhost's weekday×hour audience grid (L-aff-view). Idle until a screenhost is selected
 * (the fleet selector may start empty), so the dashboard can render the venue chooser first.
 */
export function useScreenhostAffluence(screenhostId: string | null) {
  return useQuery({
    queryKey: screenhostKeys.affluence(screenhostId ?? ''),
    queryFn: () => screenhostService.getAffluence(screenhostId as string),
    enabled: Boolean(screenhostId),
  });
}
