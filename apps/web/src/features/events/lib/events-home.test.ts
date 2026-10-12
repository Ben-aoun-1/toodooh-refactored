import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { EventItemView } from '../services/events.api';

import {
  COMING_SOON_LABEL,
  EVENTS_PATHS,
  RAMADAN_OFFER,
  footballDoorData,
  isEventsBrowsePath,
  monthsSpanLabel,
  shortFixtureDate,
} from './events-home';
import { footballSceneData, pentagonPoints, ramadanSceneData } from './home-scenes';

// The Événements home (Youssef's « Toodooh Page événements.html », operator rulings 2026-10-12:
// doors home + one page per universe, Ramadan coming soon). apps/web has no render harness: the
// rules live here and the pages are source-scanned below.

const ev = (id: string, kickoff: string, over: Partial<EventItemView> = {}): EventItemView => ({
  id,
  name: id,
  description: null,
  type: 'sport',
  category: 'Football',
  kickoff_at: kickoff,
  ends_at: kickoff,
  statut: 'a_venir',
  source: 'official',
  has_image: false,
  fenetre: { window_start: kickoff, window_end: kickoff, blocs: [] },
  ...over,
});

describe('the section paths', () => {
  it('home, football and ramadan are the browse pages; positioning is not', () => {
    expect(EVENTS_PATHS).toEqual({
      home: '/evenements',
      football: '/evenements/football',
      ramadan: '/evenements/ramadan',
    });
    for (const p of Object.values(EVENTS_PATHS)) expect(isEventsBrowsePath(p)).toBe(true);
    expect(isEventsBrowsePath('/evenements/positionnement/x')).toBe(false);
    expect(isEventsBrowsePath('/my-campaigns')).toBe(false);
  });
});

describe('the football door (live from the catalogue)', () => {
  const catalogue = [
    ev('Milan - Inter', '2026-11-01T19:00:00Z'),
    ev('Libye - Tunisie', '2026-11-15T19:00:00Z', { featured: 'pinned' }),
    ev('CA - EST', '2026-11-22T19:00:00Z', { featured: 'pinned' }),
    ev('Bayern - BVB', '2026-10-31T19:00:00Z', { date_tbc: true }),
    ev('UCL 9 déc.', '2026-12-09T20:00:00Z', { featured: 'pinned' }),
    ev('Suggested', '2026-11-02T19:00:00Z', { source: 'suggested' }),
  ];

  it('counts the official catalogue and names its months', () => {
    expect(footballDoorData(catalogue).kicker).toBe(
      '5 affiches, octobre, novembre et décembre 2026',
    );
  });

  it('lists the featured fixtures first (max 3), in date order, with a short date', () => {
    expect(footballDoorData(catalogue).fixtures).toEqual([
      { id: 'Libye - Tunisie', name: 'Libye - Tunisie', date: '15 nov.' },
      { id: 'CA - EST', name: 'CA - EST', date: '22 nov.' },
      { id: 'UCL 9 déc.', name: 'UCL 9 déc.', date: '9 déc.' },
    ]);
  });

  it('fills with the soonest when fewer than 3 are featured; an unconfirmed date says so', () => {
    const fixtures = footballDoorData([
      ev('Milan - Inter', '2026-11-01T19:00:00Z'),
      ev('Bayern - BVB', '2026-10-31T19:00:00Z', { date_tbc: true }),
    ]).fixtures;
    expect(fixtures.map((f) => f.date)).toEqual(['à confirmer', '1 nov.']);
  });

  it('an empty catalogue has no kicker and no fixture', () => {
    expect(footballDoorData([])).toEqual({ kicker: null, fixtures: [] });
  });

  it('formats months and short dates in Tunis time', () => {
    expect(monthsSpanLabel(['2026-11-03T20:00:00Z'])).toBe('novembre 2026');
    expect(monthsSpanLabel(['2026-12-31T23:30:00Z'])).toBe('janvier 2027'); // already 1/1 in Tunis
    expect(shortFixtureDate('2026-11-15T19:00:00Z')).toBe('15 nov.');
  });
});

describe('the Ramadan offer (coming soon, operator 2026-10-12)', () => {
  it('carries the design copy verbatim', () => {
    expect(RAMADAN_OFFER.cardTitle).toBe('Soirées du Ramadan 2027');
    expect(RAMADAN_OFFER.cardDates).toBe('Du lundi 8 février au lundi 8 mars 2027');
    expect(RAMADAN_OFFER.cardWindow).toBe('Diffusion chaque soir de 22h00 à 4h00');
    expect(RAMADAN_OFFER.nights).toBe(29);
    expect(COMING_SOON_LABEL).toBe('Bientôt disponible');
  });

  const read = (...p: string[]): string =>
    readFileSync(join(__dirname, '..', ...p), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');

  it('the card offers no positioning: a disabled « Bientôt disponible », no impressions box (Q4 A)', () => {
    const card = read('components', 'home', 'RamadanOfferCard.tsx');
    expect(card).toContain('disabled');
    expect(card).toContain('{COMING_SOON_LABEL}');
    expect(card).not.toContain('Je me positionne');
    expect(card).not.toContain('impressions');
    expect(card).not.toContain('onClick');
  });

  it('the door says « Bientôt disponible » too', () => {
    expect(read('components', 'home', 'RamadanDoor.tsx')).toContain('{COMING_SOON_LABEL}');
  });

  it('Q3 A — « Mes Événements » sits on the home, the suggestions on the football page', () => {
    expect(read('pages', 'EventsHome.tsx')).toContain('<MesEvenementsStrip />');
    const football = read('pages', 'Events.tsx');
    expect(football).not.toContain('MesEvenementsStrip');
    expect(football).toContain('<SuggestMatchForm />');
    expect(football).toContain('<EventsCrumb />');
  });
});

describe('the home scenes (deterministic)', () => {
  it('draws the same Ramadan night on every call (seed 2027)', () => {
    const a = ramadanSceneData();
    expect(a.stars).toHaveLength(130);
    expect(a.windows).toHaveLength(26);
    expect(ramadanSceneData()).toEqual(a);
    for (const s of a.stars) expect(s.y).toBeLessThan(260);
  });

  it('draws the same football night on every call (seed 9090)', () => {
    const a = footballSceneData();
    expect(a.crowd.length).toBeGreaterThan(1000);
    expect(a.grass).toHaveLength(420);
    expect(footballSceneData()).toEqual(a);
  });

  it('builds a pentagon of five points', () => {
    expect(pentagonPoints(0, 0, 10, -90).split(' ')).toHaveLength(5);
  });
});
