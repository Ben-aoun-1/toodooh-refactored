import { useQuery } from '@tanstack/react-query';

import { screenhostKeys } from '@/features/screenhost/hooks/queryKeys';
import {
  type OwnerRevenueSummary,
  versementsService,
} from '@/features/screenhost/services/versements.service';

/** A facture validation happens on the admin side: poll at the bell's cadence so it shows up. */
const POLL_INTERVAL_MS = 60_000;

/** OWN-REV1 — the owner dashboard's « Revenus » / « Revenu encaissé » (both TTC). */
export function useOwnerRevenueSummary(userId: string | undefined): {
  data: OwnerRevenueSummary | undefined;
  loading: boolean;
  isError: boolean;
} {
  const query = useQuery({
    queryKey: screenhostKeys.revenueSummary(userId ?? ''),
    queryFn: () => versementsService.revenueSummary(),
    enabled: Boolean(userId),
    refetchInterval: POLL_INTERVAL_MS,
  });
  return { data: query.data, loading: query.isLoading, isError: query.isError };
}
