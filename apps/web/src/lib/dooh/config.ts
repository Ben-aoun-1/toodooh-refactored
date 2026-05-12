/**
 * DOOH calculation config (legacy model). Numbers are TND for amounts, seconds for durations.
 *
 * Pure: no imports, no side effects. Lives in `lib/dooh/` (Supabase-free) so calculation
 * code can be reached without constructing the Supabase client. `services/global-configuration.service.ts`
 * loads these values from the `global_configuration` table; the defaults below are the single
 * source of truth otherwise.
 *
 * NOTE: the v3.0 pricing model (`./v3-model.ts`) has its own config type, `DoohConfigV3`.
 * This type is the *current* (pre-v3.0) engine's config — see `docs/handoff/pricing-model-v3.md`
 * and `docs/audit.md` §3 for the relationship.
 */

export type DoohConfigNumbers = {
  video_min_duration_seconds: number;
  video_max_duration_seconds: number;
  video_default_duration_seconds: number;
  max_spots_per_hour: number;
  max_billable_spot_rate_per_hour: number;
  /** Référence RPH pour le taux d’occupation par localité (voir `dooh-location-affluence-engine`). */
  dooh_occupation_reference_rph: number;
  standard_campaign_cpm_tnd: number;
  event_campaign_cpm_tnd: number;
};

export const DEFAULT_DOOH_CONFIG_NUMBERS: DoohConfigNumbers = {
  video_min_duration_seconds: 1,
  video_max_duration_seconds: 30,
  video_default_duration_seconds: 15,
  max_spots_per_hour: 10,
  max_billable_spot_rate_per_hour: 0.3,
  dooh_occupation_reference_rph: 10,
  standard_campaign_cpm_tnd: 2.5,
  event_campaign_cpm_tnd: 2.5,
};
