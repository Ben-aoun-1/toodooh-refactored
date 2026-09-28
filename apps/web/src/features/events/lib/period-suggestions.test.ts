import { describe, expect, it } from 'vitest';

import type { EventItemView } from '../services/events.api';

import { eventSuggestedForWindow } from './event-positioning';
import {
  PERIOD_SUGGESTION_MAX_TAGS,
  formatApproxImpressions,
  sectorTags,
  suggestEventsForPeriod,
} from './period-suggestions';

// SUGG-1 — « Votre campagne a été ajoutée au panier » (Figma « Lancer une campagne », last frame;
// operator ruling Q3 A 2026-09-28): the events whose kickoff falls INSIDE the campaign's own
// period — no +7-day tail (that tail stays the panier block's rule) — top 3 by proximity.

const ev = (id: string, kickoff: string, over: Partial<EventItemView> = {}): EventItemView => ({
  id,
  name: id,
  description: null,
  type: 'sport',
  category: null,
  kickoff_at: kickoff,
  ends_at: kickoff,
  statut: 'a_venir',
  source: 'official',
  has_image: false,
  fenetre: { window_start: kickoff, window_end: kickoff, blocs: [] },
  ...over,
});

const campaign = { start_date: '2027-03-10', end_date: '2027-03-19' };
const now = new Date('2027-03-01T10:00:00Z');

describe('suggestEventsForPeriod — inside the campaign period ONLY', () => {
  it('keeps kickoffs inside [start, end] (Tunis days) and drops the +7-day tail', () => {
    const list = [
      ev('first-day', '2027-03-10T00:30:00+01:00'),
      ev('last-day', '2027-03-19T23:30:00+01:00'),
      ev('day-after', '2027-03-20T00:00:00+01:00'), // the panier block would keep this one
      ev('before', '2027-03-09T23:59:00+01:00'),
    ];
    expect(suggestEventsForPeriod(campaign, list, now).map((e) => e.id)).toEqual([
      'first-day',
      'last-day',
    ]);
    // the panier block's rule is untouched: the day after still counts there
    expect(eventSuggestedForWindow('2027-03-20T00:00:00+01:00', campaign)).toBe(true);
  });

  it('top 3 by proximity, skipping non-upcoming events and the advertiser’s own positionings', () => {
    const list = [
      ev('d', '2027-03-18T20:00:00+01:00'),
      ev('a', '2027-03-11T20:00:00+01:00'),
      ev('live', '2027-03-12T20:00:00+01:00', { statut: 'en_cours' }),
      ev('mine', '2027-03-12T21:00:00+01:00'),
      ev('b', '2027-03-13T20:00:00+01:00'),
      ev('c', '2027-03-15T20:00:00+01:00'),
    ];
    const got = suggestEventsForPeriod(campaign, list, now, new Set(['mine']));
    expect(got.map((e) => e.id)).toEqual(['a', 'b', 'c']);
  });

  it('a campaign without dates suggests nothing', () => {
    const list = [ev('a', '2027-03-11T20:00:00+01:00')];
    expect(suggestEventsForPeriod({ start_date: null, end_date: null }, list, now)).toEqual([]);
  });
});

describe('the card figures', () => {
  it('« ~ N impressions » groups thousands the French way', () => {
    expect(formatApproxImpressions(184_500).replace(/\s/g, ' ')).toBe('~ 184 500 impressions');
    expect(formatApproxImpressions(0)).toBe('~ 0 impressions');
  });

  it('sector tags: display labels, at most two shown, the rest counted', () => {
    expect(PERIOD_SUGGESTION_MAX_TAGS).toBe(2);
    const tags = sectorTags(['Café', 'Espace de loisir', 'Restaurant']);
    expect(tags.shown).toHaveLength(2);
    expect(tags.extra).toBe(1);
    expect(sectorTags([])).toEqual({ shown: [], extra: 0 });
  });
});
