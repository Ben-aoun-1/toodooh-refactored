import type {
  NetworkAgeBand,
  NetworkCsp,
  NetworkPark,
  NetworkParkCategory,
  NetworkVenue,
} from '@/features/network/services/network.api';

import { NO_VALUE } from './network-format';

// RESEAU-1 — ONE model for the two pages. A venue of « Réseau Screenhosts » and a park of
// « Parcs TV » are both an *entry* made of *spots* (a venue is its own single spot, a park has one
// per location), so the hero, the map, the portrait, the list and the exclusion flow are written
// once. Every rule of the pages lives here or in the sibling libs, with tests.

export type NetworkKind = 'venues' | 'parks';
export type NetworkTab = 'tous' | 'inclus' | 'exclus';
/** The prototype's colour family of a category (card band, portrait icon and bar). */
export type NetworkTone = 'C' | 'R' | 'S' | 'M' | 'P' | 'A';

export interface NetworkCategory {
  /** Identity for tallies and for the select: the API key, or `autre:<label>`. */
  id: string;
  tone: NetworkTone;
  /** Card label, singular (« Café et salon de thé »). */
  label: string;
  /** Portrait and select label, plural (« Cafés et salons de thé »). */
  plural: string;
}

export interface NetworkSpot {
  screenhostId: string;
  quartier: string | null;
  region: string | null;
  latitude: number | null;
  longitude: number | null;
  excluded: boolean;
}

export interface NetworkEntry {
  id: string;
  name: string;
  category: NetworkCategory;
  csp: NetworkCsp | null;
  malePct: number | null;
  femalePct: number | null;
  dominantAge: string | null;
  ageBands: NetworkAgeBand[] | null;
  spots: NetworkSpot[];
  /** A park is « exclu » when ALL its locations are (and it has at least one). */
  excluded: boolean;
}

type KnownCategory = Exclude<NetworkParkCategory, 'autre'>;

const KNOWN_CATEGORIES: Record<KnownCategory, NetworkCategory> = {
  cafe: { id: 'cafe', tone: 'C', label: 'Café et salon de thé', plural: 'Cafés et salons de thé' },
  resto: {
    id: 'resto',
    tone: 'R',
    label: 'Restaurant et lounge',
    plural: 'Restaurants et lounges',
  },
  sport: { id: 'sport', tone: 'S', label: 'Salle de sport', plural: 'Salles de sport' },
  supermarche: { id: 'supermarche', tone: 'M', label: 'Supermarché', plural: 'Supermarchés' },
  pharmacie: { id: 'pharmacie', tone: 'P', label: 'Pharmacie', plural: 'Pharmacies' },
};

/** The categories each page's select always offers, in the prototype's order. */
const DEFAULT_CATEGORIES: Record<NetworkKind, KnownCategory[]> = {
  venues: ['cafe', 'resto', 'sport'],
  parks: ['supermarche', 'pharmacie', 'sport', 'cafe'],
};

export const CSP_ORDER: readonly NetworkCsp[] = ['premium', 'moyen', 'populaire'];
export const CSP_LABELS: Record<NetworkCsp, string> = {
  premium: 'Premium',
  moyen: 'Medium',
  populaire: 'Populaire',
};

export function networkCategory(key: NetworkParkCategory, apiLabel: string): NetworkCategory {
  if (key !== 'autre') return KNOWN_CATEGORIES[key];
  const label = apiLabel.trim() || 'Autre';
  return { id: `autre:${label}`, tone: 'A', label, plural: label };
}

function clean(value: string | null): string | null {
  const v = value?.trim();
  return v ? v : null;
}

export function venueEntries(venues: readonly NetworkVenue[]): NetworkEntry[] {
  return venues.map((v) => ({
    id: v.id,
    name: v.name,
    category: networkCategory(v.category, v.category_label),
    csp: v.csp,
    malePct: v.male_pct,
    femalePct: v.female_pct,
    dominantAge: clean(v.dominant_age),
    ageBands: v.age_bands && v.age_bands.length > 0 ? v.age_bands : null,
    spots: [
      {
        screenhostId: v.id,
        quartier: clean(v.quartier),
        region: clean(v.region),
        latitude: v.latitude,
        longitude: v.longitude,
        excluded: v.excluded,
      },
    ],
    excluded: v.excluded,
  }));
}

export function parkEntries(parks: readonly NetworkPark[]): NetworkEntry[] {
  return parks.map((p) => {
    const spots = p.locations.map((l) => ({
      screenhostId: l.screenhost_id,
      quartier: clean(l.quartier),
      region: clean(l.region),
      latitude: l.latitude,
      longitude: l.longitude,
      excluded: l.excluded,
    }));
    return {
      id: p.id,
      name: p.name,
      category: networkCategory(p.category, p.category_label),
      csp: p.csp,
      malePct: p.male_pct,
      femalePct: p.female_pct,
      dominantAge: clean(p.dominant_age),
      ageBands: p.age_bands && p.age_bands.length > 0 ? p.age_bands : null,
      spots,
      excluded: spots.length > 0 && spots.every((s) => s.excluded),
    };
  });
}

export function allSpots(entries: readonly NetworkEntry[]): NetworkSpot[] {
  return entries.flatMap((e) => e.spots);
}

function distinct(values: ReadonlyArray<string | null>): string[] {
  const out: string[] = [];
  for (const v of values) if (v !== null && !out.includes(v)) out.push(v);
  return out;
}

/** An entry's regions / quartiers, in the order of its spots, without repeats. */
export function entryRegions(entry: NetworkEntry): string[] {
  return distinct(entry.spots.map((s) => s.region));
}
export function entryQuartiers(entry: NetworkEntry): string[] {
  return distinct(entry.spots.map((s) => s.quartier));
}

const byFrench = (a: string, b: string) => a.localeCompare(b, 'fr');

/** The select options come from the data, never from a hardcoded list. */
export function regionOptions(entries: readonly NetworkEntry[]): string[] {
  return distinct(allSpots(entries).map((s) => s.region)).sort(byFrench);
}
export function quartierOptions(entries: readonly NetworkEntry[]): string[] {
  return distinct(allSpots(entries).map((s) => s.quartier)).sort(byFrench);
}

/** The page's own categories first (prototype order), then any other one the data carries. */
export function categoryOptions(
  kind: NetworkKind,
  entries: readonly NetworkEntry[],
): NetworkCategory[] {
  const out = DEFAULT_CATEGORIES[kind].map((k) => KNOWN_CATEGORIES[k]);
  for (const e of entries) {
    if (!out.some((c) => c.id === e.category.id)) out.push(e.category);
  }
  return out;
}

export interface NetworkFilters {
  tab: NetworkTab;
  search: string;
  region: string;
  categoryId: string;
  quartier: string;
  csp: NetworkCsp | '';
}

export const NO_FILTERS: NetworkFilters = {
  tab: 'tous',
  search: '',
  region: '',
  categoryId: '',
  quartier: '',
  csp: '',
};

/** The prototype's row filter: the tab, the four selects, then the search on name + quartiers. */
export function filterEntries(entries: readonly NetworkEntry[], f: NetworkFilters): NetworkEntry[] {
  const q = f.search.trim().toLowerCase();
  return entries.filter((e) => {
    if (f.tab === 'inclus' && e.excluded) return false;
    if (f.tab === 'exclus' && !e.excluded) return false;
    if (f.region && !e.spots.some((s) => s.region === f.region)) return false;
    if (f.categoryId && e.category.id !== f.categoryId) return false;
    if (f.quartier && !e.spots.some((s) => s.quartier === f.quartier)) return false;
    if (f.csp && e.csp !== f.csp) return false;
    if (q && !`${e.name} ${entryQuartiers(e).join(' ')}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

export interface NetworkCounts {
  total: number;
  included: number;
  excluded: number;
  spots: number;
  spotsIncluded: number;
  regions: number;
  quartiers: number;
}

export function networkCounts(entries: readonly NetworkEntry[]): NetworkCounts {
  const spots = allSpots(entries);
  const excluded = entries.filter((e) => e.excluded).length;
  return {
    total: entries.length,
    included: entries.length - excluded,
    excluded,
    spots: spots.length,
    spotsIncluded: spots.filter((s) => !s.excluded).length,
    regions: regionOptions(entries).length,
    quartiers: quartierOptions(entries).length,
  };
}

/** The selection only ever holds entries that are still in the network. */
export function pickedEntries(
  entries: readonly NetworkEntry[],
  selected: ReadonlySet<string>,
): NetworkEntry[] {
  return entries.filter((e) => selected.has(e.id) && !e.excluded);
}

/** Excluding a park = excluding all its locations: the ids one POST carries. */
export function screenhostIdsToExclude(picked: readonly NetworkEntry[]): string[] {
  return distinct(
    picked.flatMap((e) => e.spots.filter((s) => !s.excluded)).map((s) => s.screenhostId),
  );
}

/** Reintegrating = lifting every exclusion the entry carries (one DELETE each). */
export function screenhostIdsToReintegrate(entry: NetworkEntry): string[] {
  return distinct(entry.spots.filter((s) => s.excluded).map((s) => s.screenhostId));
}

/** The hero strip: one cell per spot — excluded, selected or simply in the network. */
export type NetworkCell = 'off' | 'pick' | '';
export function networkCells(
  entries: readonly NetworkEntry[],
  selected: ReadonlySet<string>,
): NetworkCell[] {
  return entries.flatMap((e) =>
    e.spots.map(
      (s): NetworkCell => (s.excluded ? 'off' : selected.has(e.id) && !e.excluded ? 'pick' : ''),
    ),
  );
}

/** « 60 / 40 » on a card; a venue without both values shows the dash. */
export function genderText(malePct: number | null, femalePct: number | null): string {
  if (malePct === null || femalePct === null) return NO_VALUE;
  return `${Math.round(malePct)} / ${Math.round(femalePct)}`;
}

export function cspText(csp: NetworkCsp | null): string {
  return csp ? CSP_LABELS[csp] : NO_VALUE;
}
