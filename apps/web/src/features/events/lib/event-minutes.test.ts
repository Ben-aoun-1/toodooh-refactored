import { describe, expect, it } from 'vitest';

import {
  EVENT_SLOT_CLASSES,
  clampEventMinutes,
  eventMinutesImpressions,
  eventMinutesPrice,
  eventSlotLabel,
  eventSlotSeconds,
  minutesLabel,
} from './event-minutes';

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
