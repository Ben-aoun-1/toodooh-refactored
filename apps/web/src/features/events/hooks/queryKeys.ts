/**
 * Step 10 — React Query key factory for the `events` feature.
 *
 * Follows the CF-13 convention: one `queryKeys.ts` per feature exporting a
 * named `<feature>Keys` factory; hierarchical readonly tuples; `.all` is the
 * feature-wide invalidation prefix.
 */
export const eventsKeys = {
  all: ['events'] as const,

  /** The full event list (advertiser-facing, page 1, fixed fetch size). */
  list: () => [...eventsKeys.all, 'list'] as const,

  /** The signed-in user's event-campaigns + the event→campaign map. */
  myCampaigns: (userId: string) => [...eventsKeys.all, 'myCampaigns', userId] as const,
};
