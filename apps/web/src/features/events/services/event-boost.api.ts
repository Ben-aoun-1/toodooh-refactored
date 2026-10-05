import { apiClient } from '@/lib/api-client';

/**
 * EV6 (flow §7) — the event booster wire. ONE axis: zones. There is deliberately no spot,
 * category or date field — the match owns those, and the surface never offers them.
 */
export interface EventBoostPreviewView {
  c_max_evt_tnd: number;
  /** How many venues the ADDED zones actually bring into reach. */
  eligible_count: number;
  /**
   * EVT-MIN1 — a positioning sized in minutes boosts in minutes: the minutes the added zones offer
   * (the slider's max) and each one's price/impressions in list order. Absent for an older
   * positioning (it keeps the TND amount).
   */
  max_minutes?: number;
  minute_prices_tnd?: number[];
  minute_impressions?: number[];
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
  /** `ask` is minutes for a positioning sized in minutes (EVT-MIN1), a TND amount otherwise. */
  apply(
    campaignId: string,
    addedZoneIds: string[],
    ask: { minutes: number } | { amountTnd: number },
  ): Promise<EventBoostAppliedView> {
    return apiClient.post(`/campaigns/${campaignId}/event-boost`, {
      added_zone_ids: addedZoneIds,
      ...('minutes' in ask ? { minutes: ask.minutes } : { amount_tnd: ask.amountTnd }),
    });
  },
};
