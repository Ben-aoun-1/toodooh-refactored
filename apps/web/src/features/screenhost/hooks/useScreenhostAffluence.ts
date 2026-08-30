import { useQuery } from '@tanstack/react-query';

import { screenhostService } from '../services/screenhost.service';

import { screenhostKeys } from './queryKeys';

/**
 * A screenhost's weekday×hour audience grid (L-aff-view). Idle until a screenhost is selected
 * (the fleet selector may start empty), so the dashboard can render the venue chooser first.
 * PERF-R2 — an optional période scopes the read to its weekdays (the api masks the others);
 * without it the read stays the unscoped typical week (the owner dashboard).
 */
export function useScreenhostAffluence(
  screenhostId: string | null,
  range?: { from: string; to: string },
) {
  return useQuery({
    queryKey: screenhostKeys.affluence(screenhostId ?? '', range?.from, range?.to),
    queryFn: () => screenhostService.getAffluence(screenhostId as string, range?.from, range?.to),
    enabled: Boolean(screenhostId),
  });
}
