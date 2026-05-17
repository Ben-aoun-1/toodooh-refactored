/**
 * Step 10 — React Query key factory for the `auth` feature.
 *
 * Follows the CF-13 convention established in `features/advertiser/hooks/
 * queryKeys.ts`: one `queryKeys.ts` per feature exporting a named
 * `<feature>Keys` factory; key values are hierarchical readonly tuples;
 * `<feature>Keys.all` is the feature-wide invalidation prefix.
 *
 * `sectors` / `governorates` are session-static reference data sourced from
 * `auth.service.ts`, so they live under the `auth` feature (it owns the
 * service) even though advertiser/screenhost pages consume them. The
 * accessors take no args — the data is not user-scoped.
 *
 * `profile` wraps `authService.getBusinessProfile()` — the owner-side
 * counterpart to `advertiserKeys.profile(userId)`. It takes `userId` purely
 * for per-user cache isolation (the service call itself is session-scoped
 * and arg-less). The advertiser↔owner duplication of this one read is
 * intentional and contained — see Step-10 Commit-5b resume brief §8 (TBD-P
 * consolidates the two onto one auth-owned hook in Phase 1).
 */
export const authKeys = {
  all: ['auth'] as const,

  sectors: () => [...authKeys.all, 'sectors'] as const,

  governorates: () => [...authKeys.all, 'governorates'] as const,

  /** Owner-side business-sector reference list (`authService.getOwnerBusinessSectors`). */
  ownerBusinessSectors: () => [...authKeys.all, 'ownerBusinessSectors'] as const,

  /** Support-appointment objective options (`authService.getAppointmentObjectives`). */
  appointmentObjectives: () => [...authKeys.all, 'appointmentObjectives'] as const,

  profile: (userId: string) => [...authKeys.all, 'profile', userId] as const,
};
