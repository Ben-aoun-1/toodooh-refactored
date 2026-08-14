/**
 * CART-V1 (operator product ruling 2026-08-13) — the cart is a PERMANENT VERTICAL BAR docked to
 * the right viewport edge while it holds ≥ 1 item (the Amazon idiom): always visible, in-flow
 * (the layout yields width — never an overlay), items stacked vertically, total at the bottom,
 * « Voir mon panier » action. EMPTY cart → nothing docked (ruled executor judgment: no bar AND
 * no corner badge — the bar materialises the instant an item lands, and /my-cart stays
 * deep-linkable). Supersedes GREEN2 item 9's cart behaviour (badge-start + expand-once); the
 * CF-HF4 always-mounted permanence continues in the docked form.
 */
export const cartBarVisible = (itemCount: number): boolean => itemCount > 0;

/**
 * Below Tailwind `lg` the permanent column is unaffordable: the bar falls back to a slim fixed
 * edge tab that expands on tap (CartEdgeTab). One constant so copy/tests state the breakpoint.
 */
export const CART_BAR_BREAKPOINT_PX = 1024;
