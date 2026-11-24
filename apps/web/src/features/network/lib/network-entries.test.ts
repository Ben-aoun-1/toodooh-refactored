import { describe, expect, it } from 'vitest';

import {
  NO_FILTERS,
  categoryOptions,
  cspText,
  filterEntries,
  genderText,
  networkCategory,
  networkCells,
  networkCounts,
  parkEntries,
  pickedEntries,
  quartierOptions,
  regionOptions,
  screenhostIdsToExclude,
  screenhostIdsToReintegrate,
  venueEntries,
} from './network-entries';
import { location, park, venue } from './network-fixtures';

const venues = venueEntries([
  venue({ id: 'a', name: 'Mirana', quartier: 'Ennasr', region: 'Ariana', csp: 'premium' }),
  venue({ id: 'b', name: 'Big 7 Café', quartier: 'La Marsa', region: 'Tunis', excluded: true }),
  venue({ id: 'c', name: 'Hillside', category: 'resto', quartier: 'Manar 1', region: 'Tunis' }),
  venue({ id: 'd', name: 'Sans adresse', quartier: null, region: null, csp: null }),
]);

describe('categories', () => {
  it('prints the prototype labels for the known categories', () => {
    expect(networkCategory('cafe', 'Café')).toMatchObject({
      label: 'Café et salon de thé',
      plural: 'Cafés et salons de thé',
      tone: 'C',
    });
    expect(networkCategory('resto', 'Restaurant').label).toBe('Restaurant et lounge');
    expect(networkCategory('sport', 'Sport').label).toBe('Salle de sport');
  });

  it('keeps the API label of another category, and tells two of them apart', () => {
    const hotel = networkCategory('autre', 'Hôtel');
    expect(hotel).toMatchObject({ label: 'Hôtel', plural: 'Hôtel', tone: 'A' });
    expect(networkCategory('autre', 'Coiffeur').id).not.toBe(hotel.id);
  });

  it('offers the page categories first, then whatever else the data carries', () => {
    const withOther = venueEntries([
      venue({ id: 'h', category: 'autre', category_label: 'Hôtel' }),
    ]);
    expect(categoryOptions('venues', withOther).map((c) => c.plural)).toEqual([
      'Cafés et salons de thé',
      'Restaurants et lounges',
      'Salles de sport',
      'Hôtel',
    ]);
    expect(categoryOptions('parks', []).map((c) => c.plural)).toEqual([
      'Supermarchés',
      'Pharmacies',
      'Salles de sport',
      'Cafés et salons de thé',
    ]);
  });
});

describe('options and counts come from the data', () => {
  it('lists each region and quartier once, sorted, without the missing ones', () => {
    expect(regionOptions(venues)).toEqual(['Ariana', 'Tunis']);
    expect(quartierOptions(venues)).toEqual(['Ennasr', 'La Marsa', 'Manar 1']);
  });

  it('counts a venue without address in the totals', () => {
    expect(networkCounts(venues)).toEqual({
      total: 4,
      included: 3,
      excluded: 1,
      spots: 4,
      spotsIncluded: 3,
      regions: 2,
      quartiers: 3,
    });
  });
});

describe('filterEntries', () => {
  const names = (f: Partial<typeof NO_FILTERS>) =>
    filterEntries(venues, { ...NO_FILTERS, ...f }).map((e) => e.name);

  it('splits the tabs on the exclusion', () => {
    expect(names({ tab: 'inclus' })).toEqual(['Mirana', 'Hillside', 'Sans adresse']);
    expect(names({ tab: 'exclus' })).toEqual(['Big 7 Café']);
    expect(names({})).toHaveLength(4);
  });

  it('applies region, category, quartier and CSP together', () => {
    expect(names({ region: 'Tunis' })).toEqual(['Big 7 Café', 'Hillside']);
    expect(names({ region: 'Tunis', categoryId: 'resto' })).toEqual(['Hillside']);
    expect(names({ quartier: 'Ennasr' })).toEqual(['Mirana']);
    expect(names({ csp: 'premium' })).toEqual(['Mirana']);
  });

  it('searches the name and the quartier, case-insensitively', () => {
    expect(names({ search: '  MARSA ' })).toEqual(['Big 7 Café']);
    expect(names({ search: 'hill' })).toEqual(['Hillside']);
    expect(names({ search: 'zzz' })).toEqual([]);
  });
});

describe('selection and exclusion', () => {
  it('never keeps an excluded entry in the selection', () => {
    expect(pickedEntries(venues, new Set(['a', 'b', 'gone'])).map((e) => e.id)).toEqual(['a']);
  });

  it('marks each cell of the strip: excluded, selected, or in the network', () => {
    expect(networkCells(venues, new Set(['a', 'b']))).toEqual(['pick', 'off', '', '']);
  });

  it('prints a dash for a value a venue does not have', () => {
    expect(genderText(60.4, 39.6)).toBe('60 / 40');
    expect(genderText(null, 40)).toBe('–');
    expect(cspText('moyen')).toBe('Medium');
    expect(cspText(null)).toBe('–');
  });
});

describe('parks', () => {
  const parks = parkEntries([
    park({
      id: 'p1',
      locations: [location('s1', 'La Marsa', 'Tunis'), location('s2', 'Ennasr', 'Ariana', true)],
    }),
    park({
      id: 'p2',
      locations: [location('s3', 'Aouina', 'Tunis', true), location('s4', 'Lac 2', 'Tunis', true)],
    }),
    park({ id: 'p3', locations: [] }),
  ]);

  it('is excluded only when ALL its locations are', () => {
    expect(parks.map((p) => p.excluded)).toEqual([false, true, false]);
  });

  it('excludes a park through every location that is still in the network', () => {
    expect(screenhostIdsToExclude(pickedEntries(parks, new Set(['p1', 'p2'])))).toEqual(['s1']);
  });

  it('reintegrates a park location by location', () => {
    const [, p2] = parks;
    expect(p2 && screenhostIdsToReintegrate(p2)).toEqual(['s3', 's4']);
  });

  it('counts parks and locations separately, and draws one cell per location', () => {
    expect(networkCounts(parks)).toMatchObject({
      total: 3,
      included: 2,
      excluded: 1,
      spots: 4,
      spotsIncluded: 1,
    });
    expect(networkCells(parks, new Set(['p1']))).toEqual(['pick', 'off', 'off', 'off']);
  });

  it('filters a park on any of its locations', () => {
    const ids = (f: Partial<typeof NO_FILTERS>) =>
      filterEntries(parks, { ...NO_FILTERS, ...f }).map((e) => e.id);
    expect(ids({ region: 'Ariana' })).toEqual(['p1']);
    expect(ids({ quartier: 'Lac 2' })).toEqual(['p2']);
    expect(ids({ search: 'aouina' })).toEqual(['p2']);
  });
});
