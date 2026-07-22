import { apiClient } from '@/lib/api-client';

// CF-B1 (spec §3.3) — the Booster wire. Strictly additive; the api enforces every rule and the
// apply is atomic (a refusal persists nothing). snake_case mirrors the endpoints exactly.

export interface BoostAdditionsWire {
  new_end_date?: string;
  added_zone_ids?: string[];
  added_category_ids?: string[];
}

export interface BoostPreviewRead {
  c_max_boost_tnd: number;
  eligible_count: number;
}

export interface BoostApplyRead {
  boost_id: string;
  placed_fact: number;
  v_fact: number;
  new_end_date: string;
  reliquat_added_fact: number;
}

export const boostApi = {
  /** The boost ceiling over the hypothetical merged state — nothing persists server-side. */
  preview(campaignId: string, additions: BoostAdditionsWire): Promise<BoostPreviewRead> {
    return apiClient.post<BoostPreviewRead>(`/campaigns/${campaignId}/boost/preview`, additions);
  },
  apply(
    campaignId: string,
    additions: BoostAdditionsWire,
    amountTnd: number,
  ): Promise<BoostApplyRead> {
    return apiClient.post<BoostApplyRead>(`/campaigns/${campaignId}/boost`, {
      ...additions,
      amount_tnd: amountTnd,
    });
  },
};
