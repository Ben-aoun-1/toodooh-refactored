import CartDockBar from './CartDockBar';
import CartEdgeTab from './CartEdgeTab';

/**
 * CF-C1 → CF-HF4 → CART-V1 (operator product ruling 2026-08-13) — the panier, mounted ONCE in
 * AdvertiserLayout on every advertiser route (the CF-HF4 permanence, continued in the docked
 * form). While the cart holds ≥ 1 item it renders as a PERMANENT right-edge bar: in-flow at
 * ≥ lg (CartDockBar — the layout row yields width, occlusion impossible by construction) and a
 * slim tap-to-expand edge tab below lg (CartEdgeTab). EMPTY cart → nothing docked (ruled
 * judgment — see lib/cart-bar.ts). Supersedes GREEN2 item 9's cart behaviour (badge-start +
 * expand-once); the notification bells' once-per-session rule is untouched.
 */
export default function CartWidget() {
  return (
    <>
      <CartDockBar />
      <CartEdgeTab />
    </>
  );
}
