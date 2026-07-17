/**
 * Step 10 — React Query key factory for the `wallet` feature.
 *
 * Follows the CF-13 convention: one `queryKeys.ts` per feature exporting a
 * named `<feature>Keys` factory; hierarchical readonly tuples; `.all` is the
 * feature-wide invalidation prefix.
 */
export const walletKeys = {
  all: ['wallet'] as const,

  /** The derived wallet balance (GET /api/wallet/balance) — CF-M1, the live money source. */
  balance: (userId: string) => [...walletKeys.all, 'balance', userId] as const,

  /** The user's recharges (GET /api/recharges/mine) — the ledger's credits AND the factures. */
  recharges: (userId: string) => [...walletKeys.all, 'recharges', userId] as const,

  /** Owner revenue summary (`revenueService.getRevenueStats`). */
  revenueStats: (userId: string) => [...walletKeys.all, 'revenueStats', userId] as const,

  /** Owner revenue series for one period bucket (`revenueService.getRevenueByPeriod`). */
  revenueByPeriod: (userId: string, period: string) =>
    [...walletKeys.all, 'revenueByPeriod', userId, period] as const,
};
