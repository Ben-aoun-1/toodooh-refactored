import { describe, expect, it } from 'vitest';

import { cartLineFigures, shownQuotes } from './cart-quote';

const quote = { prix_tnd: 149.904, impressions: 12492, venues_count: 1, c_max_tnd: 273.6 };

describe('DISP-TOURS — a classic cart line', () => {
  it('shows the exact price to the centime and the qualified impressions', () => {
    expect(cartLineFigures({ requested_budget: 150, quote })).toEqual({
      amountTnd: 149.9,
      impressions: 12492,
      budgetViseTnd: 150,
    });
  });

  it('hides the targeted budget when the price meets it to the centime', () => {
    expect(
      cartLineFigures({ requested_budget: 273.6, quote: { ...quote, prix_tnd: 273.6 } }),
    ).toMatchObject({ amountTnd: 273.6, budgetViseTnd: null });
  });

  it('keeps the budget without a quote (an event item, or the v1 engine)', () => {
    expect(cartLineFigures({ requested_budget: 150, quote: null })).toEqual({
      amountTnd: 150,
      impressions: null,
      budgetViseTnd: null,
    });
  });
});

describe('DISP-TOURS §3.4 — the figures « Lancer » sends back', () => {
  it('carries each quoted line’s price and impressions, as shown; event lines carry none', () => {
    expect(
      shownQuotes([
        { id: 'classic', quote },
        { id: 'event', quote: null },
      ]),
    ).toEqual([{ campaign_id: 'classic', prix_tnd: 149.904, impressions: 12492 }]);
  });
});
