import { apiClient } from '@/lib/api-client';

/**
 * EV6 (flow §7) — the event booster wire. ONE axis: zones. There is deliberately no spot,
 * category or date field — the match owns those, and the surface never offers them.
 */
export interface EventBoostPreviewView {
  c_max_evt_tnd: number;
  /** How many venues the ADDED zones actually bring into reach. */
  eligible_count: number;
}

export interface EventBoostAppliedView {
  boost_id: string;
  amount_tnd: number;
  placed_venues: number;
  placed_impressions: number;
  partial: boolean;
}

export const eventBoostApi = {
  preview(campaignId: string, addedZoneIds: string[]): Promise<EventBoostPreviewView> {
    return apiClient.post(`/campaigns/${campaignId}/event-boost/preview`, {
      added_zone_ids: addedZoneIds,
    });
  },
  apply(
    campaignId: string,
    addedZoneIds: string[],
    amountTnd: number,
  ): Promise<EventBoostAppliedView> {
    return apiClient.post(`/campaigns/${campaignId}/event-boost`, {
      added_zone_ids: addedZoneIds,
      amount_tnd: amountTnd,
    });
  },
};
