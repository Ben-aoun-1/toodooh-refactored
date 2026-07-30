import { describe, expect, it } from 'vitest';

import type { EventItemView } from '../services/events.api';

import {
  EVENT_SPOT_MAX_SECONDS,
  SUGGESTION_AFTER_END_DAYS,
  SUGGESTION_MAX,
  eventSpotSelectable,
  eventSuggestedForWindow,
  splitCartSections,
  suggestEventsForCampaigns,
} from './event-positioning';

// EV3 — the parcours' pure rules: the 15 s bibliothèque filter, the panier's two sections and
// the voie-3 suggestion rule (inside the window OR ≤ 7 days after the end, top 3 by proximity).

describe('eventSpotSelectable — the 15 s antenne grid', () => {
  it('videos must fit the grid; 15 s exactly passes; photos always pass', () => {
    expect(eventSpotSelectable({ creative_type: 'video', duration_seconds: 16 })).toBe(false);
    expect(eventSpotSelectable({ creative_type: 'video', duration_seconds: 15 })).toBe(true);
    expect(eventSpotSelectable({ creative_type: 'video', duration_seconds: 5 })).toBe(true);
    expect(eventSpotSelectable({ creative_type: 'video', duration_seconds: null })).toBe(false);
    expect(eventSpotSelectable({ creative_type: 'photo', duration_seconds: 30 })).toBe(true);
    expect(EVENT_SPOT_MAX_SECONDS).toBe(15);
  });
});

describe('splitCartSections — the panier files on the BINDING', () => {
  it('event-bound items land under Événements, the rest under Campagnes', () => {
    const items = [
      { id: 'a', event_id: null },
      { id: 'b', event_id: 'ev-1' },
      { id: 'c', event_id: null },
    ];
    const { campagnes, evenements } = splitCartSections(items);
    expect(campagnes.map((i) => i.id)).toEqual(['a', 'c']);
    expect(evenements.map((i) => i.id)).toEqual(['b']);
  });
});

const eventAt = (id: string, kickoffIso: string): EventItemView => ({
  id,
  name: `Match ${id}`,
  description: null,
  type: 'sport',
  category: null,
  kickoff_at: kickoffIso,
  ends_at: kickoffIso,
  statut: 'a_venir',
  source: 'official',
  has_image: false,
  fenetre: { window_start: kickoffIso, window_end: kickoffIso, blocs: [] },
});

describe('eventSuggestedForWindow — inside the window OR ≤ 7 days after the end', () => {
  const window = { start_date: '2027-06-10', end_date: '2027-06-20' };

  it('a kickoff inside the campaign window suggests', () => {
    expect(eventSuggestedForWindow('2027-06-15T20:00:00+01:00', window)).toBe(true);
  });

  it('the end day itself and up to 7 days after still suggest; day 8 does not', () => {
    expect(eventSuggestedForWindow('2027-06-20T23:00:00+01:00', window)).toBe(true);
    expect(eventSuggestedForWindow('2027-06-27T20:00:00+01:00', window)).toBe(true);
    expect(eventSuggestedForWindow('2027-06-28T01:00:00+01:00', window)).toBe(false);
    expect(SUGGESTION_AFTER_END_DAYS).toBe(7);
  });

  it('a kickoff before the window start never suggests; dateless windows never match', () => {
    expect(eventSuggestedForWindow('2027-06-09T20:00:00+01:00', window)).toBe(false);
    expect(
      eventSuggestedForWindow('2027-06-15T20:00:00+01:00', { start_date: null, end_date: null }),
    ).toBe(false);
  });
});

describe('suggestEventsForCampaigns — top 3 by proximity, à-venir only', () => {
  const windows = [{ start_date: '2027-06-10', end_date: '2027-06-20' }];
  const now = new Date('2027-06-09T12:00:00+01:00');

  it('orders by kickoff proximity and caps at 3', () => {
    const events = [
      eventAt('far', '2027-06-19T20:00:00+01:00'),
      eventAt('near', '2027-06-10T20:00:00+01:00'),
      eventAt('mid', '2027-06-14T20:00:00+01:00'),
      eventAt('mid2', '2027-06-16T20:00:00+01:00'),
    ];
    const out = suggestEventsForCampaigns(windows, events, now);
    expect(out.map((e) => e.id)).toEqual(['near', 'mid', 'mid2']);
    expect(out).toHaveLength(SUGGESTION_MAX);
  });

  it('excludes non-matching windows and non-à-venir statuts', () => {
    const termine = { ...eventAt('done', '2027-06-15T20:00:00+01:00'), statut: 'termine' as const };
    const outside = eventAt('out', '2027-07-15T20:00:00+01:00');
    expect(suggestEventsForCampaigns(windows, [termine, outside], now)).toEqual([]);
  });

  it('no classic windows → no suggestions', () => {
    expect(suggestEventsForCampaigns([], [eventAt('x', '2027-06-15T20:00:00+01:00')], now)).toEqual(
      [],
    );
  });

  // EV3 amendment (ratified): a match never suggests itself to someone already on it — the
  // requesting advertiser's OWN positionings (any status, carted included) exclude their
  // events; ANOTHER advertiser's positioning never hides a match from you (the exclusion set
  // is built from YOUR campaign list alone).
  it('excludes events the advertiser already positioned on; others’ positionings do not hide', () => {
    const mine = eventAt('mine', '2027-06-12T20:00:00+01:00');
    const theirs = eventAt('theirs', '2027-06-14T20:00:00+01:00');
    const ownPositioned = new Set(['mine']); // my draft/carted/à-venir positioning on 'mine'
    const out = suggestEventsForCampaigns(windows, [mine, theirs], now, ownPositioned);
    expect(out.map((e) => e.id)).toEqual(['theirs']);
    // 'theirs' is positioned by ANOTHER advertiser — absent from MY set, it still suggests.
  });
});
