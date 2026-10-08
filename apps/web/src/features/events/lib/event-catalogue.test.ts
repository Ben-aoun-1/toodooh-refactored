import { describe, expect, it } from 'vitest';

import type { EventItemView, TeamView } from '../services/events.api';

import {
  cardBadge,
  cardTitle,
  dateLine,
  eventsCountLabel,
  kickoffBadge,
  kickoffLine,
  layoutCatalogue,
  longDate,
  roundLine,
  searchEvents,
  selectionCta,
  swatch,
} from './event-catalogue';

// EVT-CAT2 — the new « Événements » page's pure rules (Youssef's validated design).

const team = (name: string, color: string, crowd: string | null = null): TeamView => ({
  id: name,
  name,
  is_national: false,
  color_main: color,
  color_second: '#FFFFFF',
  color_crowd: crowd,
  logo_url: null,
});

// 21:00 Tunis = 20:00Z; the window 20:00 → 00:00 Tunis.
const ev = (over: Partial<EventItemView> = {}): EventItemView => ({
  id: over.id ?? 'e',
  name: 'Match',
  description: null,
  type: 'sport',
  category: null,
  kickoff_at: '2026-11-03T20:00:00.000Z',
  ends_at: '2026-11-03T22:00:00.000Z',
  statut: 'a_venir',
  source: 'official',
  has_image: false,
  fenetre: {
    window_start: '2026-11-03T19:00:00.000Z',
    window_end: '2026-11-03T23:00:00.000Z',
    blocs: [],
  },
  ...over,
});

describe('card lines', () => {
  it('a confirmed match: its Tunis day, kickoff and diffusion window', () => {
    const e = ev();
    expect(longDate(e.kickoff_at)).toBe('Mardi 3 novembre 2026');
    expect(dateLine(e)).toBe('Mardi 3 novembre 2026');
    expect(kickoffLine(e)).toBe("Coup d'envoi 21h00, diffusion de 20h00 à 0h00");
    expect(kickoffBadge(e)).toBe('21h00');
    expect(cardBadge(e)).toBeNull();
  });

  it('not confirmed: the admin date wording, « à confirmer », and the badge', () => {
    const e = ev({ date_tbc: true, date_label: 'Week-end du 7 et 8 novembre 2026' });
    expect(dateLine(e)).toBe('Week-end du 7 et 8 novembre 2026');
    expect(kickoffLine(e)).toBe("Coup d'envoi à confirmer");
    expect(kickoffBadge(e)).toBeNull();
    expect(cardBadge(e)).toBe('Jour à confirmer');
    expect(cardBadge(ev({ time_tbc: true }))).toBe('Horaire à confirmer');
    expect(cardBadge(ev({ time_tbc: true, qualification_pending: true }))).toBe(
      'Sous réserve de qualification',
    );
  });

  it('a screencaster suggestion is badged as such (it is never an official match)', () => {
    expect(cardBadge(ev({ source: 'suggested' }))).toBe('Suggéré par un annonceur');
    expect(cardBadge(ev({ source: 'suggested', time_tbc: true }))).toBe('Horaire à confirmer');
  });

  it('titles: the event name as typed, never a generated « Soirée » (ruling 2026-10-08)', () => {
    const ca = team('Club Africain', '#D2001F');
    const est = team('Espérance de Tunis', '#C8001E');
    expect(
      cardTitle(ev({ name: 'Derby de Tunis', matches: [{ position: 0, home: ca, away: est }] })),
    ).toBe('Derby de Tunis');
    const evening = ev({
      name: 'Mardi des champions',
      competition: 'Ligue des champions',
      matches: [0, 1, 2].map((position) => ({ position, home: ca, away: est })),
    });
    expect(cardTitle(evening)).toBe('Mardi des champions');
    expect(cardTitle(ev({ name: 'Finale' }))).toBe('Finale');
  });

  it('the round line: competition and round, without saying the competition twice', () => {
    const est = team('Espérance de Tunis', '#C8001E');
    expect(roundLine(ev({ competition: 'Ligue 1 tunisienne', round: '8ème journée' }))).toBe(
      'Ligue 1 tunisienne, 8ème journée',
    );
    expect(roundLine(ev({ competition: 'Serie A', round: 'Serie A, 10ème journée' }))).toBe(
      'Serie A, 10ème journée',
    );
    expect(roundLine(ev({ competition: 'Serie A' }))).toBe('Serie A');
    expect(roundLine(ev({ round: 'Finale' }))).toBe('Finale');
    expect(roundLine(ev({ category: 'Amical' }))).toBeNull(); // the catégorie has its own chip
    expect(
      swatch(ev({ matches: [{ position: 0, home: team('A', '#000000', '#E8E8E8'), away: est }] })),
    ).toEqual(['#E8E8E8', '#C8001E']);
  });
});

describe('layoutCatalogue', () => {
  it('one hero (the first), pinned after it, the rest by Tunis month in kickoff order', () => {
    const list = [
      ev({ id: 'dec', kickoff_at: '2026-12-05T19:00:00.000Z' }),
      ev({ id: 'pin', featured: 'pinned', kickoff_at: '2026-11-22T19:00:00.000Z' }),
      ev({ id: 'hero2', featured: 'hero', kickoff_at: '2026-11-20T19:00:00.000Z' }),
      ev({ id: 'hero', featured: 'hero', kickoff_at: '2026-11-11T19:00:00.000Z' }),
      // 23:30Z on Oct 31 = 00:30 Tunis on November 1st → November.
      ev({ id: 'midnight', kickoff_at: '2026-10-31T23:30:00.000Z' }),
      ev({ id: 'nov', kickoff_at: '2026-11-01T16:30:00.000Z' }),
    ];
    const layout = layoutCatalogue(list);
    expect(layout.hero?.id).toBe('hero');
    expect(layout.pinned.map((e) => e.id)).toEqual(['hero2', 'pin']);
    expect(layout.months.map((m) => [m.label, m.events.map((e) => e.id)])).toEqual([
      ['Novembre 2026', ['midnight', 'nov']],
      ['Décembre 2026', ['dec']],
    ]);
    expect(layoutCatalogue([]).hero).toBeNull();
  });

  it('labels', () => {
    expect(eventsCountLabel(1)).toBe('1 événement');
    expect(eventsCountLabel(13)).toBe('13 événements');
    expect(selectionCta(0)).toBe('Je me positionne');
    expect(selectionCta(1)).toBe('Je me positionne sur cet événement');
    expect(selectionCta(3)).toBe('Je me positionne sur ces 3 événements');
  });
});

describe('searchEvents — the page search (operator ruling 2026-10-08, 1 A)', () => {
  const derby = ev({
    id: 'derby',
    name: 'Derby de Tunis',
    competition: 'Ligue 1 tunisienne',
    round: '8ème journée',
    stadium: 'Stade Hammadi-Agrebi',
    matches: [
      {
        position: 0,
        home: team('Espérance de Tunis', '#C8102E'),
        away: team('Club Africain', '#E30613'),
      },
    ],
  });
  const ldc = ev({
    id: 'ldc',
    name: 'Soirée LDC',
    competition: 'Ligue des champions',
    matches: [{ position: 0, home: team('Real Madrid', '#FFFFFF'), away: null }],
  });
  const suggestion = ev({
    id: 'sugg',
    name: 'Tunisie – Brésil',
    category: 'Amical',
    source: 'suggested',
  });
  const list = [derby, ldc, suggestion];
  const ids = (q: string) => searchEvents(list, q).map((e) => e.id);

  it('finds a team of any match, ignoring case AND accents', () => {
    expect(ids('esperance')).toEqual(['derby']);
    expect(ids('ESPÉRANCE')).toEqual(['derby']);
    expect(ids('africain')).toEqual(['derby']);
    expect(ids('real')).toEqual(['ldc']);
  });

  it('finds the competition, the round, the stadium, the name and the catégorie', () => {
    expect(ids('ligue')).toEqual(['derby', 'ldc']);
    expect(ids('8eme journee')).toEqual(['derby']);
    expect(ids('hammadi')).toEqual(['derby']);
    expect(ids('bresil')).toEqual(['sugg']);
    expect(ids('amical')).toEqual(['sugg']);
  });

  it('finds an undrawn opponent by the card wording', () => {
    expect(ids('apres tirage')).toEqual(['ldc']);
  });

  it('a blank query keeps everything; no match keeps nothing', () => {
    expect(ids('')).toEqual(['derby', 'ldc', 'sugg']);
    expect(ids('   ')).toEqual(['derby', 'ldc', 'sugg']);
    expect(ids('zzz')).toEqual([]);
  });
});
