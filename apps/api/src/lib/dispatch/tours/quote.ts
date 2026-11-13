// DISP-TOURS §3.4 (Mariem, 03/11/2026) — « Si une place a été prise entre l'ouverture du panier
// et le clic, réafficher les chiffres à jour avant de débiter. » The figures the cart showed (the
// exact price, the qualified impressions) against a fresh calculation — ONE comparison, read by
// the cart's confirm (before anything moves) and by the launch itself (under its locks, before
// the plan is written).

export interface ShownQuote {
  prixTnd: number;
  impressions: number;
}

/** True when the fresh figures are not the ones shown (to the centime, to the impression). */
export const quoteMoved = (shown: ShownQuote, fresh: ShownQuote): boolean =>
  Math.round(shown.prixTnd * 100) !== Math.round(fresh.prixTnd * 100) ||
  Math.round(shown.impressions) !== Math.round(fresh.impressions);
