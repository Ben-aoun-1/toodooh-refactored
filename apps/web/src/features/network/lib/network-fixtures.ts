import type { NetworkPark, NetworkVenue } from '@/features/network/services/network.api';

/** Test builders for the network libs (not imported by the app). */
export function venue(over: Partial<NetworkVenue> & { id: string }): NetworkVenue {
  return {
    name: `Lieu ${over.id}`,
    category: 'cafe',
    category_label: 'Café',
    region: 'Ariana',
    quartier: 'Ennasr',
    csp: 'moyen',
    male_pct: 60,
    female_pct: 40,
    dominant_age: '31 à 45 ans',
    age_bands: null,
    latitude: 36.86,
    longitude: 10.16,
    logo_url: null,
    excluded: false,
    ...over,
  };
}

export function park(over: Partial<NetworkPark> & { id: string }): NetworkPark {
  return {
    name: `Parc ${over.id}`,
    category: 'supermarche',
    category_label: 'Supermarché',
    csp: 'moyen',
    male_pct: 55,
    female_pct: 45,
    dominant_age: '31 à 45 ans',
    logo_url: null,
    locations: [],
    ...over,
  };
}

export function location(screenhostId: string, quartier: string, region: string, excluded = false) {
  return {
    screenhost_id: screenhostId,
    quartier,
    region,
    latitude: null,
    longitude: null,
    excluded,
  };
}
