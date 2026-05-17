/**
 * Step 10 — React Query key factory for the `wallet` feature.
 *
 * Follows the CF-13 convention: one `queryKeys.ts` per feature exporting a
 * named `<feature>Keys` factory; hierarchical readonly tuples; `.all` is the
 * feature-wide invalidation prefix.
 */
export const walletKeys = {
  all: ['wallet'] as const,

  /** The user's wallet ledger — balance + completed recharges + campaign expenses. */
  transactions: (userId: string) => [...walletKeys.all, 'transactions', userId] as const,

  /** The user's invoice list. */
  invoices: (userId: string) => [...walletKeys.all, 'invoices', userId] as const,
};
