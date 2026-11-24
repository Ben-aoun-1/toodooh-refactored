import { describe, expect, it } from 'vitest';

import {
  countLine,
  dialogDetail,
  dockText,
  dotLabel,
  emptyText,
  heroStats,
  locationLine,
  mineText,
  tabCount,
  toastText,
} from './network-copy';
import { networkCounts, parkEntries, venueEntries } from './network-entries';
import { location, park, venue } from './network-fixtures';
import { countUpAt, formatCount, plural } from './network-format';
import { NETWORK_PATHS, NETWORK_TITLES } from './network-paths';

const venues = venueEntries([
  venue({ id: 'a', quartier: 'Ennasr', region: 'Ariana' }),
  venue({ id: 'b', quartier: 'La Marsa', region: 'Tunis', excluded: true }),
  venue({ id: 'c', quartier: null, region: null }),
]);
const parks = parkEntries([
  park({
    id: 'p1',
    locations: [location('s1', 'La Marsa', 'Tunis'), location('s2', 'Ennasr', 'Ariana')],
  }),
  park({ id: 'p2', locations: [location('s3', 'Aouina', 'Tunis', true)] }),
]);

describe('hero', () => {
  it('prints the four counters of each page', () => {
    expect(heroStats('venues', networkCounts(venues), 314591)).toEqual([
      { label: 'établissements', value: 3 },
      { label: 'régions', value: 2 },
      { label: 'quartiers', value: 2 },
      { label: 'personnes par mois', value: 314591 },
    ]);
    expect(heroStats('parks', networkCounts(parks), null).map((s) => [s.label, s.value])).toEqual([
      ['parcs', 2],
      ['emplacements', 3],
      ['régions', 2],
      ['quartiers', 3],
    ]);
  });

  it('keeps a missing « personnes par mois » missing (never 0)', () => {
    expect(heroStats('venues', networkCounts(venues), null)[3]?.value).toBeNull();
  });

  it('says how much of the network is the Screencaster’s', () => {
    expect(mineText('venues', networkCounts(venues))).toEqual({
      main: '2 établissements sur 3 dans votre réseau',
      sub: '1 exclu par vous',
    });
    expect(mineText('venues', networkCounts(venues.slice(0, 1))).sub).toBe('');
    expect(mineText('parks', networkCounts(parks))).toEqual({
      main: '1 parc sur 2 dans votre réseau',
      sub: '2 emplacements sur 3 · 1 parc exclu par vous',
    });
  });

  it('labels a map dot for each page', () => {
    expect(dotLabel('venues', 'Ennasr', 1, 2)).toBe('Ennasr, 1 sur 2 dans votre réseau');
    expect(dotLabel('parks', 'Ennasr', 1, 2)).toBe('Ennasr, 1 emplacement sur 2 dans votre réseau');
  });
});

describe('list', () => {
  it('counts the tabs', () => {
    const c = networkCounts(venues);
    expect([tabCount('tous', c), tabCount('inclus', c), tabCount('exclus', c)]).toEqual([3, 2, 1]);
  });

  it('agrees the count line, the dock and the toast in number', () => {
    expect(countLine('venues', 1, 30)).toBe('1 établissement affiché sur 30');
    expect(countLine('venues', 12, 30)).toBe('12 établissements affichés sur 30');
    expect(countLine('parks', 0, 4)).toBe('0 parc affiché sur 4');
    expect(dockText('venues', 1)).toBe('1 établissement sélectionné');
    expect(dockText('venues', 3)).toBe('3 établissements sélectionnés');
    expect(dockText('parks', 2)).toBe('2 parcs sélectionnés');
    expect(toastText('venues', 1)).toBe(
      'Un établissement a été retiré de votre réseau. Vos campagnes n’y seront plus diffusées.',
    );
    expect(toastText('venues', 4)).toBe(
      '4 établissements ont été retirés de votre réseau. Vos campagnes n’y seront plus diffusées.',
    );
    expect(toastText('parks', 1)).toContain('dans aucun de ses emplacements.');
    expect(toastText('parks', 2)).toContain('dans aucun de leurs emplacements.');
  });

  it('explains an empty « Exclus » tab differently from an empty search', () => {
    expect(emptyText('venues', 'exclus', 0)).toBe(
      "Vous n'avez exclu aucun établissement. Vos campagnes peuvent être diffusées dans l'ensemble du réseau.",
    );
    expect(emptyText('venues', 'exclus', 2)).toBe(
      'Aucun établissement ne correspond à ces critères.',
    );
    expect(emptyText('parks', 'tous', 0)).toBe('Aucun parc ne correspond à ces critères.');
  });

  it('writes the line under a card name', () => {
    const [a, , c] = venues;
    const [p1, p2] = parks;
    expect(a && locationLine('venues', a)).toBe('Ennasr, Ariana');
    expect(c && locationLine('venues', c)).toBe('–');
    expect(p1 && locationLine('parks', p1)).toBe('2 emplacements, Tunis, Ariana');
    expect(p2 && locationLine('parks', p2)).toBe('1 emplacement, Tunis');
    expect(a && dialogDetail('venues', a)).toBe('Ennasr');
    expect(p1 && dialogDetail('parks', p1)).toBe('2 emplacements');
  });
});

describe('format', () => {
  it('groups thousands with a non-breaking space', () => {
    expect(formatCount(314591)).toBe('314 591');
    expect(formatCount(30)).toBe('30');
    expect(formatCount(1234.6)).toBe('1 235');
  });

  it('eases the count-up from 0 to the value', () => {
    expect(countUpAt(200, 0)).toBe(0);
    expect(countUpAt(200, 0.5)).toBe(175);
    expect(countUpAt(200, 1)).toBe(200);
    expect(countUpAt(200, 3)).toBe(200);
  });

  it('pluralises', () => {
    expect(plural(1, 'emplacement', 'emplacements')).toBe('1 emplacement');
    expect(plural(3, 'emplacement', 'emplacements')).toBe('3 emplacements');
  });
});

describe('paths', () => {
  it('titles the two pages as the prototype top bar does', () => {
    expect(NETWORK_TITLES[NETWORK_PATHS.reseau]).toBe('Réseau Screenhosts');
    expect(NETWORK_TITLES[NETWORK_PATHS.parcs]).toBe('Parcs TV');
    expect(NETWORK_TITLES['/dashboard']).toBeUndefined();
  });
});
