import { describe, expect, it } from 'vitest';

import { parkEntries, venueEntries } from './network-entries';
import { location, park, venue } from './network-fixtures';
import { ageRows, categoryRows, cspRows, genderSplit, regionRows, tally } from './network-portrait';

describe('tally', () => {
  it('counts by key, biggest first, first seen first on a tie, nulls left out', () => {
    expect(tally(['b', 'a', null, 'a', 'c', 'b'], (x) => x)).toEqual([
      ['b', 2],
      ['a', 2],
      ['c', 1],
    ]);
  });
});

describe('portrait of the venues', () => {
  const entries = venueEntries([
    venue({ id: '1', csp: 'premium', male_pct: 50, female_pct: 50 }),
    venue({ id: '2', csp: 'moyen', male_pct: 70, female_pct: 30, region: 'Tunis' }),
    venue({ id: '3', csp: 'moyen', male_pct: null, female_pct: null, region: null }),
    venue({ id: '4', csp: null, category: 'resto', male_pct: 80, female_pct: null }),
  ]);

  it('gives each category its share of the network', () => {
    expect(categoryRows(entries).map((r) => [r.category.plural, r.count, r.widthPct])).toEqual([
      ['Cafés et salons de thé', 3, 75],
      ['Restaurants et lounges', 1, 25],
    ]);
  });

  it('leaves a venue without region out of the region tile', () => {
    expect(regionRows(entries)).toEqual([
      { region: 'Ariana', count: 2 },
      { region: 'Tunis', count: 1 },
    ]);
  });

  it('counts the real CSPs in the Premium / Medium / Populaire order, skipping the unknown', () => {
    expect(cspRows(entries)).toEqual([
      { csp: 'premium', label: 'Premium', count: 1, heightPct: 50 },
      { csp: 'moyen', label: 'Medium', count: 2, heightPct: 100 },
    ]);
  });

  it('averages the gender split over the venues that have both values', () => {
    expect(genderSplit(entries)).toEqual({ male: 60, female: 40 });
  });

  it('shows nothing rather than an invented value', () => {
    const blank = venueEntries([venue({ id: 'x', csp: null, male_pct: null, female_pct: null })]);
    expect(cspRows(blank)).toBeNull();
    expect(genderSplit(blank)).toBeNull();
    expect(ageRows(blank)).toBeNull();
  });
});

describe('ageRows', () => {
  it('averages each band over the venues that carry an age split', () => {
    const entries = venueEntries([
      venue({
        id: '1',
        age_bands: [
          { label: '18 à 30 ans', pct: 20 },
          { label: '31 à 45 ans', pct: 50 },
          { label: '46 ans et plus', pct: 30 },
        ],
      }),
      venue({
        id: '2',
        age_bands: [
          { label: '18 à 30 ans', pct: 40 },
          { label: '31 à 45 ans', pct: 30 },
          { label: '46 ans et plus', pct: 30 },
        ],
      }),
      venue({ id: '3', age_bands: null }),
      venue({ id: '4', age_bands: [] }),
    ]);
    expect(ageRows(entries)).toEqual([
      { label: '18 à 30 ans', pct: 30, heightPct: 75, isMax: false },
      { label: '31 à 45 ans', pct: 40, heightPct: 100, isMax: true },
      { label: '46 ans et plus', pct: 30, heightPct: 75, isMax: false },
    ]);
  });
});

describe('portrait of the parks', () => {
  it('counts LOCATIONS per region, parks per category', () => {
    const entries = parkEntries([
      park({
        id: 'p1',
        locations: [location('s1', 'La Marsa', 'Tunis'), location('s2', 'Lac 2', 'Tunis')],
      }),
      park({ id: 'p2', category: 'pharmacie', locations: [location('s3', 'Ennasr', 'Ariana')] }),
    ]);
    expect(regionRows(entries)).toEqual([
      { region: 'Tunis', count: 2 },
      { region: 'Ariana', count: 1 },
    ]);
    expect(categoryRows(entries).map((r) => [r.category.plural, r.count])).toEqual([
      ['Supermarchés', 1],
      ['Pharmacies', 1],
    ]);
  });
});
