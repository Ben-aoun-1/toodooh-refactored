import { describe, expect, it } from 'vitest';

import { estimateImpressions } from './impressions';

describe('estimateImpressions', () => {
  it('computes ⌊budget × 1000 / cpm⌋', () => {
    // 346.5 TND at a 2.5 CPM → 138 600 (the mockup sanity value).
    expect(estimateImpressions(346.5, 2.5)).toBe(138600);
    // 5000 TND at the V1 standard CPM (15) → ⌊333333.33⌋.
    expect(estimateImpressions(5000, 15)).toBe(333333);
    expect(estimateImpressions(1000, 15)).toBe(66666);
  });

  it('floors a fractional result (never rounds up)', () => {
    expect(estimateImpressions(100, 3)).toBe(33333); // 33333.33…
  });

  it('returns 0 impressions for a zero budget at a valid CPM (a real zero, not "unknown")', () => {
    expect(estimateImpressions(0, 15)).toBe(0);
  });

  it('returns null when the CPM is unavailable (loading / errored → "—", never NaN)', () => {
    expect(estimateImpressions(5000, null)).toBeNull();
    expect(estimateImpressions(5000, undefined)).toBeNull();
  });

  it('returns null for a non-positive or non-finite CPM (division would blow up)', () => {
    expect(estimateImpressions(5000, 0)).toBeNull();
    expect(estimateImpressions(5000, -15)).toBeNull();
    expect(estimateImpressions(5000, Number.NaN)).toBeNull();
    expect(estimateImpressions(5000, Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('returns null for a non-finite or negative budget', () => {
    expect(estimateImpressions(Number.NaN, 15)).toBeNull();
    expect(estimateImpressions(-100, 15)).toBeNull();
  });
});
