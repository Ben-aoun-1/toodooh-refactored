import { describe, expect, it } from 'vitest';

import { demoEventPlacements, demoEventStart, demoEventStartDate } from '../src/lib/demo-event.js';

// DEMO-3 — the demo timeline (pure): a demo positioning's blocs are laid back to back from the
// demo's on-air instant, on a whole minute, each keeping its rank and its 20 minutes.

const MIN = 60_000;

describe('DEMO-3 — the demo timeline', () => {
  it('the first bloc opens the delay after the confirm, on the next whole minute', () => {
    expect(demoEventStart(new Date('2026-11-04T10:53:27.400Z'), 5).toISOString()).toBe(
      '2026-11-04T10:59:00.000Z',
    );
    // Already on a whole minute: no extra minute.
    expect(demoEventStart(new Date('2026-11-04T10:55:00.000Z'), 5).toISOString()).toBe(
      '2026-11-04T11:00:00.000Z',
    );
  });

  it('blocs keep their rank across venues, back to back, 20 minutes each, impressions kept', () => {
    const b = (start: string, end: string, impressions: number) => ({ start, end, impressions });
    // The match night: two pre-match blocs and one post-match bloc, shared by two venues.
    const placements = [
      {
        screenhostId: 'A',
        blocs: [
          b('2027-06-10T18:00:00.000Z', '2027-06-10T18:20:00.000Z', 30),
          b('2027-06-10T18:20:00.000Z', '2027-06-10T18:40:00.000Z', 30),
          b('2027-06-10T21:00:00.000Z', '2027-06-10T21:20:00.000Z', 30),
        ],
      },
      { screenhostId: 'B', blocs: [b('2027-06-10T18:20:00.000Z', '2027-06-10T18:40:00.000Z', 12)] },
    ];
    const start = new Date('2026-11-04T11:00:00.000Z');
    const moved = demoEventPlacements(placements, start);
    const at = (minutes: number) => new Date(start.getTime() + minutes * MIN).toISOString();
    expect(moved[0]?.blocs).toEqual([
      b(at(0), at(20), 30),
      b(at(20), at(40), 30),
      b(at(40), at(60), 30),
    ]);
    // B's bloc was A's second one: it stays shared with it.
    expect(moved[1]?.blocs).toEqual([b(at(20), at(40), 12)]);
    expect(moved[1]?.screenhostId).toBe('B');
    // The input is untouched.
    expect(placements[0]?.blocs[0]?.start).toBe('2027-06-10T18:00:00.000Z');
  });

  it('the positioning starts on the demo day, in Tunis time', () => {
    expect(demoEventStartDate(new Date('2026-11-04T11:00:00.000Z'))).toBe('2026-11-04');
    // 23:30 UTC is already the next day in Tunis (UTC+1).
    expect(demoEventStartDate(new Date('2026-11-04T23:30:00.000Z'))).toBe('2026-11-05');
  });
});
