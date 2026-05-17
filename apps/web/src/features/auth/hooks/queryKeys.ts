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
 */
export const authKeys = {
  all: ['auth'] as const,

  sectors: () => [...authKeys.all, 'sectors'] as const,

  governorates: () => [...authKeys.all, 'governorates'] as const,
};
