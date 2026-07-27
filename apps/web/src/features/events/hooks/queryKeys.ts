/**
 * React Query key factory for the `events` feature (EV1 — rebuilt on the live api; the legacy
 * Supabase list/myCampaigns keys died with their RPCs).
 *
 * CF-13 convention: one `queryKeys.ts` per feature exporting a named `<feature>Keys` factory;
 * hierarchical readonly tuples; `.all` is the feature-wide invalidation prefix.
 */
export const eventsKeys = {
  all: ['events'] as const,

  /** The official catalogue (shared — no per-user axis). */
  catalogue: () => [...eventsKeys.all, 'catalogue'] as const,

  /** « Ce que les screencasters suggèrent » — the shared suggestion list. */
  suggested: () => [...eventsKeys.all, 'suggested'] as const,

  /** A single event's presigned affiche URL. */
  imageUrl: (eventId: string) => [...eventsKeys.all, 'imageUrl', eventId] as const,
};
