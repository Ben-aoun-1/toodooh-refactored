import { describe, expect, it } from 'vitest';

import { matchPredefinedZoneNames, type ZoneMatchCandidate } from './campaign-zone-match';

const zones: ZoneMatchCandidate[] = [
  { name: 'Lac 2', latitude: 36.8451, longitude: 10.2731, radius: 1200 },
  { name: 'Centre Ville', latitude: 36.8008, longitude: 10.1817, radius: 800 },
];

describe('matchPredefinedZoneNames', () => {
  it('returns an empty list when coordinates are not all finite', () => {
    expect(matchPredefinedZoneNames(undefined, 10.18, 800, zones)).toEqual([]);
    expect(matchPredefinedZoneNames(36.8, undefined, 800, zones)).toEqual([]);
    expect(matchPredefinedZoneNames(36.8, 10.18, 'abc', zones)).toEqual([]);
    expect(matchPredefinedZoneNames(NaN, 10.18, 800, zones)).toEqual([]);
  });

  it('coerces null coordinates to 0 — inherited Number() behaviour, finite', () => {
    // `Number(null)` is 0 (finite), not NaN: a null centre is treated as a
    // real 0,0 coordinate and resolves to the "Grand Tunis" fallback, exactly
    // as the former inline blocks did.
    expect(matchPredefinedZoneNames(null, null, null, zones)).toEqual(['Grand Tunis']);
  });

  it('returns the matched zone name when centre + radius are within tolerance', () => {
    expect(matchPredefinedZoneNames(36.8451, 10.2731, 1200, zones)).toEqual(['Lac 2']);
    // Within ±0.0005° and ±50 m still matches.
    expect(matchPredefinedZoneNames(36.84514, 10.27306, 1235, zones)).toEqual(['Lac 2']);
  });

  it('falls back to "Grand Tunis" when coordinates are finite but match nothing', () => {
    expect(matchPredefinedZoneNames(35.0, 9.0, 5000, zones)).toEqual(['Grand Tunis']);
  });

  it('coerces string-typed coordinates before comparing', () => {
    expect(matchPredefinedZoneNames('36.8008', '10.1817', '800', zones)).toEqual(['Centre Ville']);
  });

  it('treats a tolerance-exceeding radius as no match', () => {
    // Centre matches Lac 2 but the radius is 200 m off (> ±50 m).
    expect(matchPredefinedZoneNames(36.8451, 10.2731, 1400, zones)).toEqual(['Grand Tunis']);
  });
});
