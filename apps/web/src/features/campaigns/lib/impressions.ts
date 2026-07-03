/**
 * Estimated potential impressions for an INDICATIVE budget at the resolved CPM (TND per 1000):
 *
 *   ⌊ budget × 1000 / cpm ⌋
 *
 * Returns `null` when the CPM is unavailable — the pricing-config query is still loading or errored —
 * or non-positive/non-finite (the division would blow up). The caller renders "—" for `null` rather
 * than a NaN/0 that would read as a real (zero) estimate. A genuine zero budget at a valid CPM yields
 * 0, which is a truthful estimate and NOT collapsed to null.
 *
 * This is the INTERIM estimate: it prices `budget` at the flat standard CPM. L-price will replace it
 * with the affluence-driven computation (répartition équitable, effective duration, indisponibilités).
 */
export function estimateImpressions(
  budgetTnd: number,
  cpmTnd: number | null | undefined,
): number | null {
  if (cpmTnd == null || !Number.isFinite(cpmTnd) || cpmTnd <= 0) return null;
  if (!Number.isFinite(budgetTnd) || budgetTnd < 0) return null;
  return Math.floor((budgetTnd * 1000) / cpmTnd);
}
