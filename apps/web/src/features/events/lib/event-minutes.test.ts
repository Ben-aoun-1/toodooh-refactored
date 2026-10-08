import { describe, expect, it } from 'vitest';

import {
  EVENT_SLOT_CLASSES,
  clampEventMinutes,
  distributeEventMinutes,
  groupMinutesBounds,
  eventMinutesImpressions,
  eventMinutesPrice,
  eventPlaysPerMinute,
  eventRepeatsLabel,
  eventSlotLabel,
  eventSlotSeconds,
  eventTotalPlays,
  groupMinutesTotal,
  minutesLabel,
} from './event-minutes';

describe('EVT-PLAY1 — how many times the ad airs in total (operator ruling Q5)', () => {
  it('plays per minute = 60 ÷ slot, for every class', () => {
    expect(eventPlaysPerMinute('video', 11)).toBe(5); // 12 s slot
    expect(eventPlaysPerMinute('video', 18)).toBe(3); // 20 s slot
    expect(eventPlaysPerMinute('video', 23)).toBe(2); // 30 s slot
    expect(eventPlaysPerMinute('video', 10)).toBe(6);
    expect(eventPlaysPerMinute('video', 15)).toBe(4);
    expect(eventPlaysPerMinute('video', 31)).toBeNull();
  });

  it('total = minutes bought × plays per minute — the operator’s example: 30 min × 11 s = 150', () => {
    expect(eventTotalPlays('video', 11, 30)).toBe(150);
    expect(eventTotalPlays('video', 18, 2)).toBe(6);
    expect(eventTotalPlays('video', 30, 1)).toBe(2);
  });

  it('an image uses the length the screencaster chose (10, 20 or 30 s)', () => {
    expect(eventTotalPlays('photo', 10, 4)).toBe(24);
    expect(eventTotalPlays('photo', 20, 4)).toBe(12);
    expect(eventTotalPlays('photo', 30, 4)).toBe(8);
    expect(eventTotalPlays('photo', 15, 4)).toBeNull(); // not an allowed image length
  });

  it('nothing to count without minutes, or with a spot that cannot air', () => {
    expect(eventTotalPlays('video', 11, null)).toBeNull();
    expect(eventTotalPlays('video', 11, 0)).toBeNull();
    expect(eventTotalPlays('video', 9, 10)).toBeNull();
  });

  it('a multi-match parcours counts the minutes of every match (one shared spot)', () => {
    expect(groupMinutesTotal(['a', 'b', 'c'], { a: 4, b: null, c: 6 })).toBe(10);
    expect(groupMinutesTotal(['a', 'b'], { a: null })).toBeNull();
    expect(groupMinutesTotal(['a'], { a: 3, z: 50 })).toBe(3); // only this parcours' matches
  });

  it('the media step line: the total once minutes are chosen, else the rate', () => {
    expect(eventRepeatsLabel('video', 11, 30)).toBe(
      'Votre annonce sera diffusée 150 fois au total (30 minutes × 5 fois par minute achetée).',
    );
    expect(eventRepeatsLabel('video', 11, 1200)).toContain('6 000 fois au total');
    expect(eventRepeatsLabel('video', 18, null)).toBe(
      'Votre annonce sera diffusée 3 fois par minute achetée — le total s’affiche dès que vous choisissez vos minutes.',
    );
    expect(eventRepeatsLabel('video', 40, 3)).toBeNull();
  });
});

// EVT-MIN1 — the web mirror of the api's minutes rules (lib/event-pricing/minutes.ts).

describe('eventSlotSeconds — the api rule, mirrored', () => {
  it('rounds a 10–30 s video up to the next divisor of the minute', () => {
    expect(EVENT_SLOT_CLASSES).toEqual([10, 12, 15, 20, 30]);
    expect(eventSlotSeconds('video', 10)).toBe(10);
    expect(eventSlotSeconds('video', 11)).toBe(12);
    expect(eventSlotSeconds('video', 16)).toBe(20);
    expect(eventSlotSeconds('video', 23)).toBe(30);
    expect(eventSlotSeconds('video', 9)).toBeNull();
    expect(eventSlotSeconds('video', 31)).toBeNull();
    expect(eventSlotSeconds('video', null)).toBeNull();
  });

  it('an image keeps its chosen 10, 20 or 30 s', () => {
    expect(eventSlotSeconds('photo', 20)).toBe(20);
    expect(eventSlotSeconds('photo', 15)).toBeNull();
  });
});

describe('eventSlotLabel', () => {
  it('names the filler: 23 s → 30 s slot, 7 s of Toodooh screen, twice a minute', () => {
    expect(eventSlotLabel('video', 23)).toBe(
      'Créneau de 30 s — 23 s de spot + 7 s d’écran Toodooh, 2 fois par minute',
    );
    expect(eventSlotLabel('video', 15)).toBe('Créneau de 15 s — 15 s, 4 fois par minute');
    expect(eventSlotLabel('photo', 10)).toBe('Créneau de 10 s — 10 s, 6 fois par minute');
    expect(eventSlotLabel('video', 40)).toBeNull();
  });
});

describe('the slider sums', () => {
  const prices = [7.2, 7.2, 3, 3];
  const impressions = [480, 480, 200, 200];

  it('N minutes cost the sum of the first N ordered minutes, to the centime', () => {
    expect(eventMinutesPrice(prices, 0)).toBe(0);
    expect(eventMinutesPrice(prices, 3)).toBe(17.4);
    expect(eventMinutesPrice(prices, 9)).toBe(20.4);
    expect(eventMinutesImpressions(impressions, 3)).toBe(1160);
  });

  it('clamps a choice into [1, max]; nothing to choose when no seat is free', () => {
    expect(clampEventMinutes(null, 6)).toBeNull();
    expect(clampEventMinutes(9, 6)).toBe(6);
    expect(clampEventMinutes(0, 6)).toBe(1);
    expect(clampEventMinutes(3, 0)).toBeNull();
  });

  it('labels minutes in French', () => {
    expect(minutesLabel(1)).toBe('1 minute');
    expect(minutesLabel(12)).toBe('12 minutes');
  });
});

describe('distributeEventMinutes — ruling A1 (proportional to each match’s free minutes)', () => {
  const sum = (a: number[]) => a.reduce((s, n) => s + n, 0);

  it('spreads in proportion, sums exactly, every open match keeps ≥ 1', () => {
    expect(distributeEventMinutes(20, [30, 10])).toEqual([15, 5]);
    expect(distributeEventMinutes(4, [30, 10])).toEqual([3, 1]);
    const parts = distributeEventMinutes(17, [12, 7, 5]);
    expect(sum(parts)).toBe(17);
    parts.forEach((p, i) => {
      expect(p).toBeGreaterThanOrEqual(1);
      expect(p).toBeLessThanOrEqual([12, 7, 5][i] ?? 0);
    });
  });

  it('clamps into [one per open match, all minutes]; a full match gets 0', () => {
    expect(groupMinutesBounds([6, 0, 3])).toEqual({ min: 2, max: 9 });
    expect(distributeEventMinutes(1, [6, 0, 3])).toEqual([1, 0, 1]);
    expect(distributeEventMinutes(99, [6, 0, 3])).toEqual([6, 0, 3]);
    expect(distributeEventMinutes(5, [0, 0])).toEqual([0, 0]);
  });

  it('is monotonic: one more on the big slider never takes a minute from a match', () => {
    const maxes = [9, 4, 13, 1];
    let prev = distributeEventMinutes(4, maxes);
    for (let t = 5; t <= 27; t += 1) {
      const next = distributeEventMinutes(t, maxes);
      expect(sum(next)).toBe(t);
      next.forEach((p, i) => expect(p).toBeGreaterThanOrEqual(prev[i] ?? 0));
      prev = next;
    }
  });
});
