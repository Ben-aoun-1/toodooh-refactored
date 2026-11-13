import { describe, expect, it } from 'vitest';

import { spreadCoincident } from './map-venues';

const venue = (id: string, latitude: number, longitude: number) => ({
  id,
  latitude,
  longitude,
  sector_name: null,
});

describe('spreadCoincident (MAP-2)', () => {
  it('leaves venues at distinct coordinates where they are', () => {
    const venues = [venue('a', 36.8, 10.18), venue('b', 36.81, 10.2)];
    expect(spreadCoincident(venues)).toEqual(venues);
  });

  it('moves the second venue of a shared coordinate onto a ~15 m ring, keeping the first', () => {
    const [first, second] = spreadCoincident([venue('a', 36.8, 10.18), venue('b', 36.8, 10.18)]);
    expect(first).toEqual(venue('a', 36.8, 10.18));
    expect(second?.id).toBe('b');
    expect(second?.latitude).not.toBe(36.8);
    expect(Math.abs((second?.latitude ?? 0) - 36.8)).toBeLessThan(0.0002);
    expect(Math.abs((second?.longitude ?? 0) - 10.18)).toBeLessThan(0.0002);
  });
});
