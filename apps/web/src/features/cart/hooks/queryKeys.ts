/**
 * CF-C1 — React Query key factory for the `cart` feature (the CF-13 convention). ONE read key:
 * the page and the floating widget share the same cache entry by construction.
 */
export const cartKeys = {
  all: ['cart'] as const,

  /** The caller's cart (GET /api/cart) — shared by the page AND the widget. */
  read: () => [...cartKeys.all, 'read'] as const,
};
