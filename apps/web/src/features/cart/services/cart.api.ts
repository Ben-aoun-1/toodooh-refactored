import type { CampaignView } from '@/features/campaigns/services/campaigns.api';
import { apiClient } from '@/lib/api-client';

/**
 * CF-C1 — the panier wire (routes/cart.ts). Items ride the campaign projection + added_at;
 * the page composes display detail (zones/targeting chips) from the /mine cache — one
 * projection home. NO money moves at confirm (the api states it; the activation funding gate
 * and settlement are unchanged).
 */

export interface CartItemView extends CampaignView {
  added_at: string;
}

export interface CartRead {
  items: CartItemView[];
  total_ht: number;
  count: number;
}

export interface CartConfirmResult {
  confirmed: CampaignView[];
  /** CF-SK1 — already-approved spots: launched on the spot, never queued for review. */
  launched: CampaignView[];
  /** New spots: draft → pending, waiting on the admin. */
  pending_review: CampaignView[];
}

export const cartApi = {
  read(): Promise<CartRead> {
    return apiClient.get<CartRead>('/cart');
  },
  /** Add a COMPLETE draft (the api gates with the precise code); idempotent re-add is a 200. */
  add(campaignId: string): Promise<{ campaign_id: string; added_at: string | null }> {
    return apiClient.post('/cart/items', { campaign_id: campaignId });
  },
  /** « Conserver en brouillon » — the item leaves the cart, the campaign stays a draft. */
  remove(campaignId: string): Promise<{ removed: boolean; campaign_id: string }> {
    return apiClient.del(`/cart/items/${campaignId}`);
  },
  /**
   * ONE confirm launches them all; failures carry per-item reasons (+ solde) in ApiError.body.
   * CF-SK1 — the outcome SPLITS: `launched` skipped review entirely (their spot was already
   * approved — ruling #9) and are upcoming/active; `pending_review` await the admin. `confirmed`
   * is the union (back-compatible).
   */
  confirm(): Promise<CartConfirmResult> {
    return apiClient.post('/cart/confirm');
  },
};
