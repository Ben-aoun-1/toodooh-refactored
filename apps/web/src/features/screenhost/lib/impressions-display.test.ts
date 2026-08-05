import { describe, expect, it } from 'vitest';

import { lineImpressions, sumLineImpressions } from './impressions-display';

// NET-IMP1 — the swap PERF-QA1's R10 home was built for: owners see the api-computed
// « affichées = prédites − perdues » (display_imp), never a raw delivered/expected count.
describe('lineImpressions (the single swap point — swapped by NET-IMP1)', () => {
  it('renders display_imp verbatim (the api home owns the arithmetic)', () => {
    expect(lineImpressions({ display_imp: 800 })).toBe(800);
    expect(lineImpressions({ display_imp: 0 })).toBe(0);
  });
});

describe('sumLineImpressions', () => {
  it('sums through the single home', () => {
    expect(
      sumLineImpressions([{ display_imp: 800 }, { display_imp: 150 }, { display_imp: 0 }]),
    ).toBe(950);
    expect(sumLineImpressions([])).toBe(0);
  });
});
