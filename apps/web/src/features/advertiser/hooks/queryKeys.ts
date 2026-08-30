/**
 * Step 10 — React Query key factory for the `advertiser` feature.
 *
 * Convention (CF-13 candidate — first worked example lands here):
 *
 *   - One `queryKeys.ts` per feature folder; it exports a single named
 *     factory object `<feature>Keys` (here: `advertiserKeys`).
 *   - Accessor shape: `<feature>Keys.<view>(<args>)`.
 *   - The key *value* is a hierarchical readonly tuple
 *     `['<feature>', '<view>', ...args]` — so the runtime key encodes the
 *     `<feature> → <view> → args` hierarchy even though the accessor is a
 *     per-feature object rather than one global `queryKeys` object.
 *   - `<feature>Keys.all` is the feature-wide prefix; passing it to
 *     `invalidateQueries` invalidates every query in the feature (React
 *     Query matches query keys by prefix).
 *
 * A single global `queryKeys` object was rejected: every feature commit
 * would have to edit one shared file (merge-conflict surface) and it
 * contradicts the per-feature-folder ownership rule (plan D6).
 */
export const advertiserKeys = {
  all: ['advertiser'] as const,

  dashboardStats: (userId: string) => [...advertiserKeys.all, 'dashboardStats', userId] as const,

  lastCampaigns: (userId: string, limit: number) =>
    [...advertiserKeys.all, 'lastCampaigns', userId, limit] as const,

  featuredEvents: (limit: number) => [...advertiserKeys.all, 'featuredEvents', limit] as const,

  profile: (userId: string) => [...advertiserKeys.all, 'profile', userId] as const,

  /** The advertiser notification-bell feed (Commit 8 — D5). */
  notifications: (userId: string) => [...advertiserKeys.all, 'notifications', userId] as const,
};
