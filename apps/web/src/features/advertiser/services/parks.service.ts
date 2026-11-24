import { apiClient } from '@/lib/api-client';

// The TV parks (« parcs TV ») a Screencaster can air on: one brand, several venues. Read for the
// dashboard's « Diffusez votre spot publicitaire sur une même enseigne » section. snake_case wire
// shape = the api contract (GET /api/network/parks).

export interface NetworkParkLocation {
  screenhost_id: string;
  quartier: string | null;
  region: string | null;
  latitude: number | null;
  longitude: number | null;
  /** The Screencaster excluded this venue from his diffusion. */
  excluded: boolean;
}

export interface NetworkPark {
  id: string;
  name: string;
  category: string;
  category_label: string;
  csp: 'premium' | 'moyen' | 'populaire' | null;
  male_pct: number | null;
  female_pct: number | null;
  dominant_age: string | null;
  logo_url: string | null;
  locations: NetworkParkLocation[];
}

export const parksService = {
  list(): Promise<{ parks: NetworkPark[] }> {
    return apiClient.get<{ parks: NetworkPark[] }>('/network/parks');
  },
};
