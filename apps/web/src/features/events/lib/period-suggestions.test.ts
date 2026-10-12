import { describe, expect, it } from 'vitest';

import type { EventItemView } from '../services/events.api';

import { eventSuggestedForWindow } from './event-positioning';
import {
  PERIOD_SUGGESTION_MAX_TAGS,
  addedPageState,
  formatApproxImpressions,
  sectorTags,
  suggestEventsForPeriod,
} from './period-suggestions';

// SUGG-1 — « Votre campagne a été ajoutée au panier », operator 2026-10-13: every event the
// screencaster can position on — during the campaign first, then « à la une », then the rest,
// soonest first in each band, no cap.

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

describe('suggestEventsForPeriod — during the campaign, then à la une, then the rest', () => {
  it('orders the three bands, each soonest first, with no cap', () => {
    const list = [
      ev('later', '2027-04-20T20:00:00+01:00'),
      ev('hero-late', '2027-05-01T20:00:00+01:00', { featured: 'hero' }),
      ev('in-2', '2027-03-18T20:00:00+01:00'),
      ev('soon-after', '2027-03-20T20:00:00+01:00'),
      ev('pinned', '2027-04-02T20:00:00+01:00', { featured: 'pinned' }),
      ev('in-1', '2027-03-11T20:00:00+01:00'),
      ev('in-featured', '2027-03-12T20:00:00+01:00', { featured: 'hero' }),
    ];
    expect(suggestEventsForPeriod(campaign, list).map((e) => e.id)).toEqual([
      'in-1',
      'in-featured',
      'in-2',
      'pinned',
      'hero-late',
      'soon-after',
      'later',
    ]);
  });

  it('the period is the campaign’s own Tunis days (the day after is no longer « during »)', () => {
    const list = [
      ev('day-after', '2027-03-20T00:00:00+01:00'),
      ev('last-day', '2027-03-19T23:30:00+01:00'),
    ];
    expect(suggestEventsForPeriod(campaign, list).map((e) => e.id)).toEqual([
      'last-day',
      'day-after',
    ]);
    // the panier block's rule is untouched: the day after still counts there
    expect(eventSuggestedForWindow('2027-03-20T00:00:00+01:00', campaign)).toBe(true);
  });

  it('only events with « Je me positionne »: upcoming, confirmed, not already the advertiser’s', () => {
    const list = [
      ev('ok', '2027-03-11T20:00:00+01:00'),
      ev('live', '2027-03-12T20:00:00+01:00', { statut: 'en_cours' }),
      ev('tbc', '2027-03-13T20:00:00+01:00', { positionable: false }),
      ev('mine', '2027-03-14T21:00:00+01:00'),
    ];
    expect(suggestEventsForPeriod(campaign, list, new Set(['mine'])).map((e) => e.id)).toEqual([
      'ok',
    ]);
  });

  it('a campaign without dates still lists the events (no « during » band)', () => {
    const list = [ev('b', '2027-03-12T20:00:00+01:00'), ev('a', '2027-03-11T20:00:00+01:00')];
    expect(
      suggestEventsForPeriod({ start_date: null, end_date: null }, list).map((e) => e.id),
    ).toEqual(['a', 'b']);
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

describe('addedPageState — a stale cached list never forwards a NEW campaign to the panier', () => {
  it('the campaign is in the list → the page shows, even while a refetch runs', () => {
    expect(addedPageState({ found: true, loading: false, fetching: false })).toBe('ready');
    expect(addedPageState({ found: true, loading: false, fetching: true })).toBe('ready');
  });

  it('not in a CACHED list while it refetches (the wizard-created draft) → wait, never redirect', () => {
    expect(addedPageState({ found: false, loading: false, fetching: true })).toBe('loading');
  });

  it('first load in flight → wait', () => {
    expect(addedPageState({ found: false, loading: true, fetching: true })).toBe('loading');
  });

  it('not in a FRESH list (an unknown id) → missing, the page forwards to the panier', () => {
    expect(addedPageState({ found: false, loading: false, fetching: false })).toBe('missing');
  });
});
