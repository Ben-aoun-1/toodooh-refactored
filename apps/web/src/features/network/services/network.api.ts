import { apiClient } from '@/lib/api-client';

// RESEAU-1 — the Screencaster's view of the Screenhost network and of the TV parks, and the
// exclusions (« Ne plus diffuser dans ces établissements ») it can set and lift at any time.

export type NetworkCsp = 'premium' | 'moyen' | 'populaire';
export type NetworkVenueCategory = 'cafe' | 'resto' | 'sport' | 'autre';
export type NetworkParkCategory = NetworkVenueCategory | 'supermarche' | 'pharmacie';

export interface NetworkAgeBand {
  label: string;
  pct: number;
}

export interface NetworkVenue {
  id: string;
  name: string;
  category: NetworkVenueCategory;
  category_label: string;
  region: string | null;
  quartier: string | null;
  csp: NetworkCsp | null;
  male_pct: number | null;
  female_pct: number | null;
  dominant_age: string | null;
  age_bands: NetworkAgeBand[] | null;
  latitude: number | null;
  longitude: number | null;
  logo_url: string | null;
  excluded: boolean;
}

export interface NetworkResponse {
  persons_per_month: number | null;
  venues: NetworkVenue[];
}

export interface NetworkParkLocation {
  screenhost_id: string;
  quartier: string | null;
  region: string | null;
  latitude: number | null;
  longitude: number | null;
  excluded: boolean;
}

export interface NetworkPark {
  id: string;
  name: string;
  category: NetworkParkCategory;
  category_label: string;
  csp: NetworkCsp | null;
  male_pct: number | null;
  female_pct: number | null;
  dominant_age: string | null;
  logo_url: string | null;
  locations: NetworkParkLocation[];
}

export interface NetworkParksResponse {
  parks: NetworkPark[];
}

export const networkApi = {
  network: () => apiClient.get<NetworkResponse>('/network'),
  parks: () => apiClient.get<NetworkParksResponse>('/network/parks'),
  exclude: (screenhostIds: string[]) =>
    apiClient.post<{ excluded_ids: string[] }>('/network/exclusions', {
      screenhost_ids: screenhostIds,
    }),
  reintegrate: (screenhostId: string) =>
    apiClient.del<{ reintegrated: true }>(
      `/network/exclusions/${encodeURIComponent(screenhostId)}`,
    ),
};
