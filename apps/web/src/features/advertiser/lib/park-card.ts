import type { NetworkPark } from '../services/parks.service';

// The dashboard's « Diffusez votre spot publicitaire sur une même enseigne » cards: what a park
// card prints, pure.

/** The dashboard shows three parks at most; « Voir tous les parcs » opens the rest. */
export const DASHBOARD_PARKS = 3;
export const PARKS_PATH = '/parcs-tv';

/** « CA » for « Carrefour Alimentation » — the tile shown while a park has no logo. */
export function parkInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  const letters =
    words.length === 1
      ? (words[0] ?? '').slice(0, 2)
      : `${words[0]?.[0] ?? ''}${words[1]?.[0] ?? ''}`;
  return letters.toUpperCase();
}

/** « 1 établissement » / « 12 établissements » — every venue of the park. */
export function parkVenuesLabel(park: Pick<NetworkPark, 'locations'>): string {
  const n = park.locations.length;
  return `${n} établissement${n > 1 ? 's' : ''}`;
}
