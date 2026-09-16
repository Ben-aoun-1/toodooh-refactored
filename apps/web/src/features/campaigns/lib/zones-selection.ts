// CF-Z1 — the Zones step's pure selection logic, pinned by unit test (no render harness).

/** Toggle one zone id in the selected set (order preserved for the untouched entries). */
export const toggleZone = (selected: readonly string[], zoneId: string): string[] =>
  selected.includes(zoneId) ? selected.filter((id) => id !== zoneId) : [...selected, zoneId];

/**
 * The recap « couverture » label: the selected zone names, or « Tout le réseau » when NO zone is
 * selected (VF US-2.1 — no zones = whole network on that criterion).
 */
export const zonesRecapLabel = (selectedNames: readonly string[]): string =>
  selectedNames.length === 0 ? 'Tout le réseau' : selectedNames.join(', ');

/**
 * Default selection for a FRESH wizard once the zones load: every active zone — which in V1 is
 * exactly « Grand Tunis », the ruled default. A resumed/edited campaign keeps its persisted set
 * (even empty = whole network); a user who already touched the step is never overridden.
 */
export const defaultZoneSelection = (
  fetchedZoneIds: readonly string[],
  opts: { isEdit: boolean; touched: boolean; current: readonly string[] },
): string[] => {
  if (opts.isEdit || opts.touched || opts.current.length > 0) return [...opts.current];
  return [...fetchedZoneIds];
};

/**
 * MAP-5 note (operator 2026-09-16) — the map is a VISUALISATION of the eligible screenhosts, not a
 * broadcast list: dispatch picks among them, so the advertiser must not read « my spot plays on
 * every dot ». Shown under the coverage map.
 */
export const COVERAGE_MAP_NOTE =
  "La carte montre les screenhosts éligibles à votre campagne. C'est une visualisation : votre campagne ne sera pas forcément diffusée sur chacun d'eux.";
