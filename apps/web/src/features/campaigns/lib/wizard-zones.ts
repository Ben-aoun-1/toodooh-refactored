import type { GeographicZone } from '../hooks/new-campaign/wizard-types';

/**
 * Total area in km² covered by a set of geographic zones, modeling each
 * zone as a circle of its `radius` (meters). Sum of π × (r/1000)² across
 * all zones — overlapping zones double-count by design (same convention
 * used at every call site).
 */
export function zonesAreaKm2(zones: GeographicZone[]): number {
  return zones.reduce((sum, z) => sum + Math.PI * Math.pow(z.radius / 1000, 2), 0);
}

/**
 * Human-readable label for a zone selection: "N zone(s) · X.X km²". Returns
 * `undefined` when no zones are present (call sites use this in optional
 * fields where absence is rendered as "—" or omission).
 */
export function zonesLabel(zones: GeographicZone[]): string | undefined {
  if (zones.length === 0) return undefined;
  return `${zones.length} zone${zones.length > 1 ? 's' : ''} · ${zonesAreaKm2(zones).toFixed(1)} km²`;
}
