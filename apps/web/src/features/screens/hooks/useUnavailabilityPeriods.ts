import { useQuery } from '@tanstack/react-query';

import {
  screensService,
  type UnavailabilityPeriod,
} from '@/features/screens/services/screens.service';
import { logger } from '@/lib/logger';

import { screensKeys } from './queryKeys';

const log = logger.child({ module: 'useUnavailabilityPeriods' });

/**
 * Unavailability periods for a set of screens — campaign-wizard DOOH estimate
 * input (`NewCampaign`, Commit 7a).
 *
 * `screens.service` is screens-owned (D6), so this read hook lands here even
 * though its only consumer is a campaigns page. It wraps the existing
 * per-screen `getUnavailabilityPeriods` call (D4): the queryFn fans out one
 * request per screen and accumulates the fulfilled results. `allSettled`
 * preserves the original loop's behaviour — one screen's failure logs and is
 * skipped rather than failing the whole estimate.
 */
export function useUnavailabilityPeriods(screenIds: string[]): {
  periods: UnavailabilityPeriod[];
  loading: boolean;
  isError: boolean;
} {
  const query = useQuery({
    queryKey: screensKeys.unavailabilityForScreens(screenIds),
    queryFn: async (): Promise<UnavailabilityPeriod[]> => {
      const results = await Promise.allSettled(
        screenIds.map((screenId) => screensService.getUnavailabilityPeriods(screenId)),
      );
      const all: UnavailabilityPeriod[] = [];
      results.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          all.push(...result.value);
        } else {
          log.error(
            { error: result.reason },
            `Erreur chargement indisponibilités écran ${screenIds[index]}`,
          );
        }
      });
      return all;
    },
    enabled: screenIds.length > 0,
  });

  return {
    periods: query.data ?? [],
    loading: query.isLoading,
    isError: query.isError,
  };
}
