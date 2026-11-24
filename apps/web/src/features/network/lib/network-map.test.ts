import { describe, expect, it } from 'vitest';

import type { NetworkSpot } from './network-entries';
import {
  MAP_HEIGHT,
  MAP_WIDTH,
  dotRadius,
  legendRegions,
  mapLinks,
  quartierDots,
  regionColor,
  regionLabels,
  regionTone,
} from './network-map';

function spot(
  quartier: string | null,
  region: string | null,
  latitude: number | null,
  longitude: number | null,
  excluded = false,
): NetworkSpot {
  return {
    screenhostId: `${quartier}-${latitude}`,
    quartier,
    region,
    latitude,
    longitude,
    excluded,
  };
}

const grandTunis: NetworkSpot[] = [
  spot('Ennasr', 'Ariana', 36.862, 10.159),
  spot('Ennasr', 'Ariana', 36.864, 10.161, true),
  spot('Menzah 9', 'Ariana', 36.848, 10.158),
  spot('Ariana Soghra', 'Ariana', 36.9, 10.19),
  spot('La Marsa', 'Tunis', 36.878, 10.325),
  spot('Aouina', 'Tunis', 36.853, 10.26),
  spot('Lac 2', 'Tunis', 36.845, 10.27),
  spot('Mourouj 4', 'Ben Arous', 36.72, 10.21),
  spot('Boumhal', 'Ben Arous', 36.73, 10.3),
];

const find = (dots: ReturnType<typeof quartierDots>, q: string) => {
  const dot = dots.find((d) => d.quartier === q);
  if (!dot) throw new Error(`no dot for ${q}`);
  return dot;
};

describe('region colours', () => {
  it('keeps the prototype hues, whatever the spelling', () => {
    expect(regionColor('Ariana')).toBe('#76E6AB');
    expect(regionColor(' tunis ')).toBe('#FFFFFF');
    expect(regionColor('Ben Arous')).toBe('#9195F8');
    expect(regionTone('BEN AROUS')).toBe('benarous');
  });

  it('gives any other region a neutral colour', () => {
    expect(regionColor('Sousse')).toBe('#C5D6CD');
    expect(regionColor(null)).toBe('#C5D6CD');
    expect(regionTone('Béja')).toBe('other');
  });
});

describe('quartierDots', () => {
  const dots = quartierDots(grandTunis);

  it('draws one dot per quartier, sized by its spots, counting those still included', () => {
    expect(dots).toHaveLength(8);
    expect(find(dots, 'Ennasr')).toMatchObject({ count: 2, included: 1, r: dotRadius(2) });
    expect(find(dots, 'La Marsa')).toMatchObject({ count: 1, included: 1, region: 'Tunis' });
  });

  it('puts north up and east right', () => {
    expect(find(dots, 'Ariana Soghra').y).toBeLessThan(find(dots, 'Mourouj 4').y);
    expect(find(dots, 'La Marsa').x).toBeGreaterThan(find(dots, 'Ennasr').x);
  });

  it('keeps every dot, halo included, inside the viewBox', () => {
    for (const d of dots) {
      expect(d.x - d.r - 12).toBeGreaterThanOrEqual(0);
      expect(d.x + d.r + 12).toBeLessThanOrEqual(MAP_WIDTH);
      expect(d.y - d.r - 12).toBeGreaterThanOrEqual(0);
      expect(d.y + d.r + 12).toBeLessThanOrEqual(MAP_HEIGHT);
    }
  });

  it('never lets two dots overlap, even for neighbouring quartiers', () => {
    for (let i = 0; i < dots.length; i += 1) {
      for (let j = i + 1; j < dots.length; j += 1) {
        const [a, b] = [dots[i], dots[j]];
        if (!a || !b) continue;
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(a.r + b.r);
      }
    }
  });

  it('separates quartiers that share the very same coordinates', () => {
    const twins = quartierDots([spot('A', 'Tunis', 36.8, 10.2), spot('B', 'Tunis', 36.8, 10.2)]);
    const [a, b] = twins;
    expect(a && b && Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(dotRadius(1) * 2);
  });

  it('centres a single quartier', () => {
    const [only] = quartierDots([spot('Ennasr', 'Ariana', 36.86, 10.16)]);
    expect(only?.x).toBeCloseTo(MAP_WIDTH / 2, 0);
  });

  it('does not draw a spot without quartier or a quartier without any coordinates', () => {
    const drawn = quartierDots([
      spot(null, 'Tunis', 36.8, 10.2),
      spot('Lafayette', 'Tunis', null, null),
      spot('Aouina', 'Tunis', 36.85, 10.26),
      spot('Aouina', 'Tunis', null, null),
    ]);
    expect(drawn.map((d) => [d.quartier, d.count])).toEqual([['Aouina', 2]]);
  });

  it('is empty for an empty network', () => {
    expect(quartierDots([])).toEqual([]);
  });

  it('caps the radius of a very large quartier', () => {
    expect(dotRadius(1)).toBeCloseTo(12.6);
    expect(dotRadius(40)).toBe(32);
  });
});

describe('map dressing', () => {
  const dots = quartierDots(grandTunis);

  it('ties every dot to its nearest ones, each pair once', () => {
    const links = mapLinks(dots);
    expect(links.length).toBeGreaterThanOrEqual(dots.length);
    expect(links.length).toBeLessThanOrEqual(dots.length * 2);
    const keys = links.map((l) => [`${l.x1},${l.y1}`, `${l.x2},${l.y2}`].sort().join('|'));
    expect(new Set(keys).size).toBe(keys.length);
    expect(mapLinks(dots.slice(0, 1))).toEqual([]);
  });

  it('names only the regions that have dots', () => {
    expect(
      regionLabels(dots)
        .map((l) => l.region)
        .sort(),
    ).toEqual(['Ariana', 'Ben Arous', 'Tunis']);
    const ariana = dots.filter((d) => d.region === 'Ariana');
    expect(regionLabels(ariana).map((l) => l.region)).toEqual(['Ariana']);
    for (const l of regionLabels(dots)) expect(l.y).toBeLessThanOrEqual(MAP_HEIGHT);
  });

  it('lists the legend in the prototype order, other regions last', () => {
    const more = quartierDots([...grandTunis, spot('Sahloul', 'Sousse', 35.83, 10.59)]);
    expect(legendRegions(more)).toEqual(['Ariana', 'Tunis', 'Ben Arous', 'Sousse']);
  });
});
