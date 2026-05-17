/**
 * Step 10 — React Query key factory for the `performances` feature.
 *
 * Follows the CF-13 convention: one `queryKeys.ts` per feature exporting a
 * named `<feature>Keys` factory; hierarchical readonly tuples; `.all` is the
 * feature-wide invalidation prefix.
 *
 * `performances` is a page-less service feature (its only page placeholder
 * is `AdvertiserPerformancePlaceholder`); per CF-13's second amendment the
 * factory + hooks are created here, under the feature that owns
 * `performance.service`, by Commit 5b — the first commit migrating a
 * consumer (`screenhost/OwnerPerformance`).
 */
export const performancesKeys = {
  all: ['performances'] as const,

  /** OwnerPerformance composite: owner campaign scope + `getDataset`. */
  dataset: (userId: string) => [...performancesKeys.all, 'dataset', userId] as const,
};
