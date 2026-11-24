import { describe, expect, it } from 'vitest';

import { parkInitials, parkVenuesLabel } from './park-card';

const location = (id: string) => ({
  screenhost_id: id,
  quartier: null,
  region: null,
  latitude: null,
  longitude: null,
  excluded: false,
});

describe('parkInitials', () => {
  it('takes the first letters of the first two words', () => {
    expect(parkInitials('Carrefour Market')).toBe('CM');
    expect(parkInitials('  california gym tunis ')).toBe('CG');
  });

  it('takes two letters of a single word', () => {
    expect(parkInitials('Carrefour')).toBe('CA');
  });

  it('never returns an empty tile', () => {
    expect(parkInitials('   ')).toBe('?');
  });
});

describe('parkVenuesLabel', () => {
  it('agrees in number', () => {
    expect(parkVenuesLabel({ locations: [] })).toBe('0 établissement');
    expect(parkVenuesLabel({ locations: [location('a')] })).toBe('1 établissement');
    expect(parkVenuesLabel({ locations: [location('a'), location('b')] })).toBe('2 établissements');
  });
});
