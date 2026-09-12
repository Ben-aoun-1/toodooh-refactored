/**
 * Step 10 — React Query key factory for the `screens` feature.
 *
 * Follows the CF-13 convention: one `queryKeys.ts` per feature exporting a
 * named `<feature>Keys` factory; hierarchical readonly tuples; `.all` is the
 * feature-wide invalidation prefix.
 *
 * The `screens` feature is a page-less service layer (per the Commit-5-skip
 * decision); these hooks are created here, under the owning feature, by the
 * first commit that migrates a consumer (5a — screenhost screens pages).
 */
export const screensKeys = {
  all: ['screens'] as const,

  /** The owner's screen list (screensService.getScreens). */
  list: () => [...screensKeys.all, 'list'] as const,

  /** OwnerScreens composite: screens + unavailability periods + auto-accept map. */
  ownerScreensData: () => [...screensKeys.all, 'ownerScreensData'] as const,

  /** OwnerCalendarDevices composite: screens + unavailability periods. */
  calendarDevices: () => [...screensKeys.all, 'calendarDevices'] as const,

  /**
   * Predefined geographic zones. `predefined-zones.service` is screens-owned
   * (D6), so its admin consumer (`GeographicZonesManagement`, Commit 6c) keys
   * here rather than under `adminKeys`. Commit 7a adds the campaign-wizard
   * consumer (`NewCampaign`) on the same key — one cache entry, two readers.
   */
  predefinedZones: () => [...screensKeys.all, 'predefinedZones'] as const,

  /**
   * Unavailability periods for a set of screens (campaign-wizard DOOH
   * estimate, Commit 7a). The screen IDs are deduplicated and sorted into one
   * stable string segment so a re-ordered ID list resolves to the same entry.
   */
  unavailabilityForScreens: (screenIds: readonly string[]) =>
    [
      ...screensKeys.all,
      'unavailabilityForScreens',
      [...new Set(screenIds)].sort().join(','),
    ] as const,
};
