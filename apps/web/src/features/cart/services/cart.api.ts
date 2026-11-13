import type { CampaignView } from '@/features/campaigns/services/campaigns.api';
import type { ShownQuote } from '@/features/cart/lib/cart-quote';
import type { EventItemView } from '@/features/events/services/events.api';
import { apiClient } from '@/lib/api-client';

/**
 * CF-C1 — the panier wire (routes/cart.ts). Items ride the campaign projection + added_at;
 * the page composes display detail (zones/targeting chips) from the /mine cache — one
 * projection home. NO money moves at confirm (the api states it; the activation funding gate
 * and settlement are unchanged).
 */

/**
 * DISP-TOURS — a classic item's figures, recomputed at every opening of the cart (Mariem R12):
 * the budget stays the target; the exact price (at or under it) and the qualified impressions
 * follow the affluence and the places left right now. null = an event item, or the v1 engine.
 */
export interface CartQuote {
  prix_tnd: number;
  impressions: number;
  venues_count: number;
  c_max_tnd: number;
}

export interface CartItemView extends CampaignView {
  added_at: string;
  /** EV3 — the positioned match + its DERIVED window (null on classic campaign items). */
  event: EventItemView | null;
  quote: CartQuote | null;
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
  confirm(quotes: ShownQuote[] = []): Promise<CartConfirmResult> {
    // DISP-TOURS §3.4 — the figures shown: the api launches nothing if they moved since.
    return apiClient.post('/cart/confirm', { quotes });
  },
};
