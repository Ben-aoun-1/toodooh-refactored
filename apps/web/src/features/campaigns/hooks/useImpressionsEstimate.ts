import { useQuery } from '@tanstack/react-query';

import {
  type EstimateInputs,
  type EstimateView,
  estimateInputsKey,
  estimateView,
} from '@/features/campaigns/lib/impressions-estimate';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';

import { campaignsApi } from '../services/campaigns.api';

import { campaignsKeys } from './queryKeys';

/** The /cmax posture: a short staleTime, live occupancy on every real fetch. */
export const ESTIMATE_STALE_TIME_MS = 30_000;
/** The cursor must rest this long before the dry-run is asked (a 1-TND step fires per step). */
export const ESTIMATE_DEBOUNCE_MS = 300;

interface UseImpressionsEstimateOptions {
  /** The cursor: a number sizes the dry-run with it, null = no budget chosen yet, undefined = the
   *  campaign's stored requested_budget. */
  budgetTnd?: number | null;
  inputs?: EstimateInputs;
  enabled?: boolean;
}

/**
 * IMP-EST1 — « Impressions estimées » for one campaign (GET /:id/impressions-estimate), already
 * shaped for display (lib/impressions-estimate: « … » / the number / « — » + the reason).
 */
export function useImpressionsEstimate(
  campaignId: string | null,
  { budgetTnd, inputs = {}, enabled = true }: UseImpressionsEstimateOptions = {},
): EstimateView {
  const cursor = useDebouncedValue(budgetTnd, ESTIMATE_DEBOUNCE_MS);
  const query = useQuery({
    queryKey: campaignsKeys.impressionsEstimate(
      campaignId ?? '',
      cursor ?? 'stored',
      estimateInputsKey(inputs),
    ),
    queryFn: () => campaignsApi.impressionsEstimate(campaignId ?? '', cursor ?? undefined),
    enabled: enabled && !!campaignId && cursor !== null,
    staleTime: ESTIMATE_STALE_TIME_MS,
  });
  return estimateView({
    budgetUnset: budgetTnd === null,
    pending: cursor !== budgetTnd || query.isPending,
    isError: query.isError,
    data: query.data,
  });
}
