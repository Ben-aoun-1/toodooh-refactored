import type { CoverageVenue } from '@/features/campaigns/services/campaigns.api';

/**
 * MAP-2 — établissements sharing one coordinate (same building, same typed address) painted as
 * ONE dot, so the map showed fewer dots than the caption counted. Spread coincident venues on a
 * small ring (~15 m) so every covered venue has its own visible dot. Leaflet-free, so both
 * coverage maps (the wizard's and the Foot parcours') share it and the node tests can pin it.
 */
export const spreadCoincident = (venues: CoverageVenue[]): CoverageVenue[] => {
  const seen = new Map<string, number>();
  return venues.map((v) => {
    const key = `${v.latitude.toFixed(5)}:${v.longitude.toFixed(5)}`;
    const n = seen.get(key) ?? 0;
    seen.set(key, n + 1);
    if (n === 0) return v;
    const angle = (n * 2 * Math.PI) / 6;
    const delta = 0.00014; // ≈ 15 m
    return {
      ...v,
      latitude: v.latitude + delta * Math.sin(angle),
      longitude: v.longitude + delta * Math.cos(angle),
    };
  });
};
