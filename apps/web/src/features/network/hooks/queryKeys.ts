/**
 * React Query key factory for the `network` feature (CF-13 convention: one `queryKeys.ts` per
 * feature; hierarchical readonly tuples; `.all` is the feature-wide invalidation prefix).
 */
export const networkKeys = {
  all: ['network'] as const,
  /** The Screenhost network as this Screencaster sees it (venues + its exclusions). */
  venues: () => [...networkKeys.all, 'venues'] as const,
  /** The TV parks and their locations. */
  parks: () => [...networkKeys.all, 'parks'] as const,
};
