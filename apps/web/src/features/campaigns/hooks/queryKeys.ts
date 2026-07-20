/**
 * Step 10 — React Query key factory for the `campaigns` feature.
 *
 * Follows the CF-13 convention: one `queryKeys.ts` per feature exporting a
 * named `<feature>Keys` factory; hierarchical readonly tuples; `.all` is the
 * feature-wide invalidation prefix (React Query matches query keys by prefix).
 *
 * Created by Commit 7a — the first campaigns React Query consumer
 * (the `NewCampaign` creation flow). `list` and `detail` are
 * declared here even though no query reads them yet: Commit 7a's
 * campaign-write mutations invalidate `campaignsKeys.list(userId)`
 * forward-compatibly so that Commit 7b (`MyCampaigns` / `CampaignDetails`)
 * consumes a key the creation-flow mutations already refresh — the same
 * factory→consumer handoff shape 6c established for `screensKeys`.
 *
 * `locations` / `screenIds` key off a *set* of location IDs; the args are
 * deduplicated and sorted into one stable string segment so a re-ordered or
 * duplicate-bearing ID list resolves to the same cache entry.
 */
function stableIdsSegment(ids: readonly string[]): string {
  return [...new Set(ids)].sort().join(',');
}

export const campaignsKeys = {
  all: ['campaigns'] as const,

  /** The signed-in advertiser's campaign list (`MyCampaigns` — Commit 7b). */
  list: (userId: string) => [...campaignsKeys.all, 'list', userId] as const,

  /** A single campaign's detail view (`CampaignDetails` — Commit 7b). */
  detail: (id: string) => [...campaignsKeys.all, 'detail', id] as const,

  /** E5 — the live C_max ceiling for the Validation-step budget cursor (GET /:id/cmax). */
  cmax: (id: string) => [...campaignsKeys.all, 'cmax', id] as const,

  /** Persisted `campaign_categories` rows for a campaign (edit-mode hydration). */
  categories: (campaignId: string) => [...campaignsKeys.all, 'categories', campaignId] as const,

  /** Hydrated `CampaignLocation[]` for a set of selected location IDs. */
  locations: (locationIds: readonly string[]) =>
    [...campaignsKeys.all, 'locations', stableIdsSegment(locationIds)] as const,

  /** Active screen IDs belonging to a set of selected location IDs. */
  screenIds: (locationIds: readonly string[]) =>
    [...campaignsKeys.all, 'screenIds', stableIdsSegment(locationIds)] as const,

  /** A single `videos` row by id (Commit 7b — `useVideoById`, 4-consumer read). */
  video: (videoId: string) => [...campaignsKeys.all, 'video', videoId] as const,

  /** The signed-in advertiser's approved videos (`Step5` picker source). */
  myApprovedVideos: (userId: string) => [...campaignsKeys.all, 'myApprovedVideos', userId] as const,

  /** Special events overlapping a campaign's period (post-cart recommendations). */
  recommendedEvents: (startIso: string, endIso: string, excludeEventId: string) =>
    [...campaignsKeys.all, 'recommendedEvents', startIso, endIso, excludeEventId] as const,

  /** Persisted `campaign_locations` for a campaign (edit-mode zone hydration). */
  zonesForEdit: (campaignId: string) => [...campaignsKeys.all, 'zonesForEdit', campaignId] as const,

  /**
   * Campaigns awaiting a screen owner's approval. `campaign-owner-approval`
   * service is campaigns-owned (D6), so the owner-side consumer keys here.
   */
  ownerApprovals: (ownerId: string) => [...campaignsKeys.all, 'ownerApprovals', ownerId] as const,

  /** A campaign's audience targeting lines (L-target — category × class). */
  targeting: (campaignId: string) => [...campaignsKeys.all, 'targeting', campaignId] as const,

  /** Screenhosts matching a campaign's targeting — the Couverture-step coverage map. */
  coverage: (campaignId: string) => [...campaignsKeys.all, 'coverage', campaignId] as const,

  /** The signed-in advertiser's creative library (L-spot — the Creative step picker source). */
  myCreatives: (userId: string) => [...campaignsKeys.all, 'myCreatives', userId] as const,

  /** A single creative by id (upload seeds this cache; the picker reads it). */
  creative: (creativeId: string) => [...campaignsKeys.all, 'creative', creativeId] as const,

  /** A creative's presigned media URL (GET /:id/url) — the Validation-step Spot preview. */
  creativeUrl: (creativeId: string) => [...campaignsKeys.all, 'creativeUrl', creativeId] as const,

  /** The advertiser-readable CPM pricing config — the Validation-step impressions estimate. */
  pricingConfig: () => [...campaignsKeys.all, 'pricingConfig'] as const,

  /** CF-Z1 — the predefined zones the wizard offers (GET /api/zones). */
  zones: () => [...campaignsKeys.all, 'zones'] as const,
};
