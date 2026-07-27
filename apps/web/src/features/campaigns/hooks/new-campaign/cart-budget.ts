import { CAMPAIGN_BUDGET_FLOOR_TND } from '@/features/campaigns/lib/cmax-budget';

/**
 * Cart-budget slider primitives (TND). E5: the interim flat 5 000 ceiling RETIRED from the
 * slider — the max is now the campaign's live C_max (GET /:id/cmax, assemblePool's occupancy
 * truth). MIN remains this module's.
 */
// CF-U3 (Mejri) — the slider min IS the campaign budget floor (ONE home in lib/cmax-budget,
// mirroring the api's MIN_CAMPAIGN_BUDGET_TND).
export const CART_BUDGET_MIN_TND = CAMPAIGN_BUDGET_FLOOR_TND;
/** SUPERSEDED (E5): no longer feeds the slider — kept for reference/tests only. */
export const CART_BUDGET_MAX_TND = 5000;
// CF-HF3 (Mejri) — step 1 TND. The old 50 was a leftover of the flat-5000 era: an
// <input type="range"> only reaches min + n·step, so with an arbitrary integer C_max the
// displayed max was UNREACHABLE (100 → 150, max 155 dead). C_max is a server-side
// Math.floor integer, so (max − min) is always a multiple of 1 — the max is now EXACTLY
// attainable. Shared by the wizard slider AND the Booster modal (one step, one rule).
export const CART_BUDGET_STEP_TND = 1;

/**
 * SUPERSEDED (CF-U1, Mejri item 6): the slider no longer defaults to a VALUE — the budget stays
 * null (« — ») until the advertiser drags the cursor, so drafts can never inherit a phantom
 * 5 000. Constant kept for reference/tests; nothing seeds state from it anymore.
 */
export const CART_BUDGET_DEFAULT_TND = CART_BUDGET_MAX_TND;
