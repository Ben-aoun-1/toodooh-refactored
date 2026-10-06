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

  it('titles: one match, an undrawn opponent, an evening of three, a bare event', () => {
    const ca = team('Club Africain', '#D2001F');
    const est = team('Espérance de Tunis', '#C8001E');
    expect(cardTitle(ev({ matches: [{ position: 0, home: ca, away: est }] }))).toBe(
      'Club Africain - Espérance de Tunis',
    );
    expect(cardTitle(ev({ matches: [{ position: 0, home: est, away: null }] }))).toBe(
      'Espérance de Tunis - Adversaire après tirage',
    );
    const evening = ev({
      competition: 'Ligue des champions',
      matches: [0, 1, 2].map((position) => ({ position, home: ca, away: est })),
    });
    expect(cardTitle(evening)).toBe('Soirée Ligue des champions, 3 affiches au choix');
    expect(cardTitle(ev({ name: 'Finale' }))).toBe('Finale');
    expect(roundLine(ev({ competition: 'Serie A', round: 'Serie A, 10ème journée' }))).toBe(
      'Serie A, 10ème journée',
    );
    expect(roundLine(ev({ competition: 'Serie A' }))).toBe('Serie A');
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
