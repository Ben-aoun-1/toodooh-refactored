/**
 * Resolve a campaign's predefined-zone label from its stored centre + radius.
 *
 * Extracted in Commit 7b: `MyCampaigns` and `CampaignDetails` both ran the
 * same geo-match inline (centre within ±0.0005°, radius within ±50 m of a
 * predefined zone). Hoisting it to one pure function gives both `useQuery`
 * transforms a single tested implementation.
 *
 * Behaviour preserved verbatim from the two former inline blocks:
 * - coordinates not all finite → `[]` (no zone label),
 * - finite + a predefined zone matches → `[<zone name>]`,
 * - finite + no match → `['Grand Tunis']` (the inherited default label).
 */
export interface ZoneMatchCandidate {
  name: string | null;
  latitude: number | string | null;
  longitude: number | string | null;
  radius: number | string | null;
}

const LATLNG_TOLERANCE = 0.0005;
const RADIUS_TOLERANCE_M = 50;

export function matchPredefinedZoneNames(
  campaignLat: number | string | null | undefined,
  campaignLng: number | string | null | undefined,
  campaignRadius: number | string | null | undefined,
  zones: readonly ZoneMatchCandidate[],
): string[] {
  const lat = Number(campaignLat);
  const lng = Number(campaignLng);
  const radius = Number(campaignRadius);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(radius)) {
    return [];
  }

  const matched = zones.find(
    (zone) =>
      Math.abs(Number(zone.latitude) - lat) <= LATLNG_TOLERANCE &&
      Math.abs(Number(zone.longitude) - lng) <= LATLNG_TOLERANCE &&
      Math.abs(Number(zone.radius) - radius) <= RADIUS_TOLERANCE_M,
  );

  return matched?.name ? [matched.name] : ['Grand Tunis'];
}
