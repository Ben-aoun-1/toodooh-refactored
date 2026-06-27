/**
 * Step 10 — React Query key factory for the `screenhost` feature.
 *
 * Follows the CF-13 convention: one `queryKeys.ts` per feature exporting a
 * named `<feature>Keys` factory; hierarchical readonly tuples; `.all` is the
 * feature-wide invalidation prefix.
 *
 * `screenhost` owns owner-facing composites that have no service layer and
 * no other consumer — e.g. the `OwnerCampaigns` campaign-oversight read,
 * which is shaped specifically for the owner view (owner-share maths, owner
 * location/screen scoping). Generic campaign-domain reads belong to the
 * `campaigns` feature (Commit 7), not here.
 */
export const screenhostKeys = {
  all: ['screenhost'] as const,

  /** OwnerCampaigns composite: every campaign touching the owner's parc. */
  campaignsOverview: (userId: string) =>
    [...screenhostKeys.all, 'campaignsOverview', userId] as const,

  /** The owner notification-bell feed (Commit 8 — D5). */
  notifications: (userId: string) => [...screenhostKeys.all, 'notifications', userId] as const,

  /** The owner's screenhosts WiFi list (GET /api/screenhosts/mine). */
  screenhostsMine: (userId: string) => [...screenhostKeys.all, 'screenhostsMine', userId] as const,

  /** A screenhost's weekday×hour audience grid (L-aff-view — GET /:id/affluence). */
  affluence: (screenhostId: string) => [...screenhostKeys.all, 'affluence', screenhostId] as const,
};
