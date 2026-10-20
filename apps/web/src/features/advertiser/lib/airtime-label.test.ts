import { describe, expect, it } from 'vitest';

import { airtimeLabel } from './airtime-label';

describe('DUR-1 — the airtime tile label', () => {
  it('keeps HH:MM:SS under a day', () => {
    expect(airtimeLabel(0)).toBe('00:00:00');
    expect(airtimeLabel(3661)).toBe('01:01:01');
    expect(airtimeLabel(86_399)).toBe('23:59:59');
  });

  it('switches to days from 24 h', () => {
    expect(airtimeLabel(86_400)).toBe('1 j 00 h 00 min');
    // Myriam's screenshot: 2620:54:30 → 109 days 4 h 54 min.
    expect(airtimeLabel(2620 * 3600 + 54 * 60 + 30)).toBe('109 j 04 h 54 min');
  });
});
