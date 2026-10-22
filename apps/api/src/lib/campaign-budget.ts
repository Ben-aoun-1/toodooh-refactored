// CF-U3 → FLOOR-0 (Mejri 21/10 point 5, operator ruling A) — the ONE home of the campaign budget
// minimum. The 100 TND floor is gone: any budget ABOVE 0 is accepted, for every screencaster; a
// budget of 0 (or none) is what blocks. Every gate (submit, cart, boosts, simulator) asks
// `isBelowCampaignMinimum` so none can keep an old floor of its own.
export const MIN_CAMPAIGN_BUDGET_TND = 0;

/** True when the amount cannot be a campaign or boost budget: it must be strictly above 0. */
export const isBelowCampaignMinimum = (amountTnd: number): boolean =>
  !(amountTnd > MIN_CAMPAIGN_BUDGET_TND);
