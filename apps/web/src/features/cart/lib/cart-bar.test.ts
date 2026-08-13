import { describe, expect, it } from 'vitest';

import { CART_BAR_BREAKPOINT_PX, cartBarVisible } from './cart-bar';

// CART-V1 (operator ruling 2026-08-13) — the docked-bar visibility rule: ≥ 1 item → docked,
// 0 → nothing (no bar, no corner badge — the ruled executor judgment).
describe('cartBarVisible', () => {
  it('docked from the first item, nothing at zero', () => {
    expect(cartBarVisible(0)).toBe(false);
    expect(cartBarVisible(1)).toBe(true);
    expect(cartBarVisible(7)).toBe(true);
  });

  it('the responsive fallback breakpoint is lg (1024px) — below it the slim edge tab takes over', () => {
    expect(CART_BAR_BREAKPOINT_PX).toBe(1024);
  });
});
