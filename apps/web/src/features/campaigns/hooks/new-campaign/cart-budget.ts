/**
 * Interim cart-budget slider bounds (TND). Per the operator ruling the validation step shows a plain
 * 0–5000 slider whose default position is the MAX — until Youssef's pricing lands, when the real
 * computed min/max + impressions-preview cursor (L-price, I_cible) replaces it.
 */
export const CART_BUDGET_MIN_TND = 0;
export const CART_BUDGET_MAX_TND = 5000;
export const CART_BUDGET_STEP_TND = 50;

/**
 * SUPERSEDED (CF-U1, Mejri item 6): the slider no longer defaults to a VALUE — the budget stays
 * null (« — ») until the advertiser drags the cursor, so drafts can never inherit a phantom
 * 5 000. Constant kept for reference/tests; nothing seeds state from it anymore.
 */
export const CART_BUDGET_DEFAULT_TND = CART_BUDGET_MAX_TND;
