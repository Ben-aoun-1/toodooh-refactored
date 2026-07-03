import { apiClient } from '@/lib/api-client';

// The advertiser-readable CPM config (GET /api/campaigns/pricing-config) — the wizard's Validation
// step prices a budget→impressions estimate from it. snake_case wire shape mirrors the API exactly.
// These are DISPLAY inputs (they price the advertiser's own estimate), not the engine's activation
// derivation; L-price replaces the estimate later.

export interface PricingConfig {
  standard_cpm_tnd: number;
  event_cpm_tnd: number;
}

export const pricingApi = {
  config(): Promise<PricingConfig> {
    return apiClient.get<PricingConfig>('/campaigns/pricing-config');
  },
};
