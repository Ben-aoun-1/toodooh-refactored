import { describe, expect, it } from 'vitest';

import { lineImpressions, sumLineImpressions } from './impressions-display';

// PERF-QA1 R10 — the ONE owner-side impressions display home. These pins document today's
// contract (delivered_imp verbatim); the net-impressions lane will change them DELIBERATELY,
// in this one file, when it swaps the home's body.
describe('lineImpressions (the single swap point)', () => {
  it('returns delivered_imp verbatim today', () => {
    expect(lineImpressions({ delivered_imp: 800 })).toBe(800);
    expect(lineImpressions({ delivered_imp: 0 })).toBe(0);
  });
});

describe('sumLineImpressions', () => {
  it('sums through the single home', () => {
    expect(
      sumLineImpressions([{ delivered_imp: 800 }, { delivered_imp: 150 }, { delivered_imp: 0 }]),
    ).toBe(950);
    expect(sumLineImpressions([])).toBe(0);
  });
});
