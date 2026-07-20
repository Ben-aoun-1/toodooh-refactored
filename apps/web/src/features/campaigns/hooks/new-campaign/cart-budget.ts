import { CAMPAIGN_BUDGET_FLOOR_TND } from '@/features/campaigns/lib/cmax-budget';

/**
 * Cart-budget slider primitives (TND). E5: the interim flat 5 000 ceiling RETIRED from the
 * slider — the max is now the campaign's live C_max (GET /:id/cmax, assemblePool's occupancy
 * truth). MIN and the visual step granularity remain this module's.
 */
// CF-U3 (Mejri) — the slider min IS the campaign budget floor (ONE home in lib/cmax-budget,
// mirroring the api's MIN_CAMPAIGN_BUDGET_TND).
export const CART_BUDGET_MIN_TND = CAMPAIGN_BUDGET_FLOOR_TND;
/** SUPERSEDED (E5): no longer feeds the slider — kept for reference/tests only. */
export const CART_BUDGET_MAX_TND = 5000;
export const CART_BUDGET_STEP_TND = 50;

/**
 * SUPERSEDED (CF-U1, Mejri item 6): the slider no longer defaults to a VALUE — the budget stays
 * null (« — ») until the advertiser drags the cursor, so drafts can never inherit a phantom
 * 5 000. Constant kept for reference/tests; nothing seeds state from it anymore.
 */
export const CART_BUDGET_DEFAULT_TND = CART_BUDGET_MAX_TND;
