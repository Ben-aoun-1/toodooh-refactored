import { useQuery } from '@tanstack/react-query';

import { pricingApi } from '../services/pricing.api';

import { campaignsKeys } from './queryKeys';

/**
 * The resolved CPM pricing config (GET /api/campaigns/pricing-config) — prices the Validation-step
 * budget→impressions estimate. While this is loading or errored the consumer must render "—" rather
 * than a NaN estimate (the impressions helper returns null for a missing CPM). Any authenticated
 * user may read it, so no userId gate is needed.
 */
export function usePricingConfig() {
  return useQuery({
    queryKey: campaignsKeys.pricingConfig(),
    queryFn: () => pricingApi.config(),
  });
}
