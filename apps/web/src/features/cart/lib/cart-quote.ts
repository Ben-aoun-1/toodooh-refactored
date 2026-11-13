import type { CartQuote } from '@/features/cart/services/cart.api';

/**
 * DISP-TOURS — what a classic cart line shows (Mariem R9, R12): the EXACT price — the sum of the
 * passages actually placed, at or just under the targeted budget (149,90 for 150) — and the
 * qualified impressions it buys, recomputed at every opening. The targeted budget is shown
 * beside it only when the two differ. Without a quote (an event item, the v1 engine) the line
 * keeps showing the budget.
 */
export interface CartLineFigures {
  /** The amount on the line (TND HT). */
  amountTnd: number | null;
  /** Qualified impressions, or null without a quote. */
  impressions: number | null;
  /** The targeted budget, when it differs from the price (null otherwise). */
  budgetViseTnd: number | null;
}

const centimes = (n: number): number => Math.round(n * 100);

export const cartLineFigures = (item: {
  requested_budget: number | null;
  quote: CartQuote | null;
}): CartLineFigures => {
  if (item.quote === null) {
    return { amountTnd: item.requested_budget, impressions: null, budgetViseTnd: null };
  }
  const differs =
    item.requested_budget !== null &&
    centimes(item.requested_budget) !== centimes(item.quote.prix_tnd);
  return {
    amountTnd: Math.round(item.quote.prix_tnd * 100) / 100,
    impressions: item.quote.impressions,
    budgetViseTnd: differs ? item.requested_budget : null,
  };
};

/** The figures sent back with « Lancer » — exactly those the lines show (cart.api confirm). */
export interface ShownQuote {
  campaign_id: string;
  prix_tnd: number;
  impressions: number;
}

/**
 * DISP-TOURS §3.4 — « Lancer » carries the figures the cart showed for each quoted line: if a
 * place was taken since, the api launches nothing and the cart re-reads its new figures.
 */
export const shownQuotes = (
  items: readonly { id: string; quote: CartQuote | null }[],
): ShownQuote[] =>
  items.flatMap((item) =>
    item.quote === null
      ? []
      : [
          {
            campaign_id: item.id,
            prix_tnd: item.quote.prix_tnd,
            impressions: item.quote.impressions,
          },
        ],
  );
