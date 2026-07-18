/**
 * CF-U1 — the ONE home of advertiser-facing money formatting (Mejri item 6): every displayed
 * montant carries its TTC in parentheses — « 1 000 TND HT (1 190 TND TTC) » — and the 19% TVA
 * lives HERE and nowhere else. fr-FR grouping (narrow no-break spaces), at most 2 decimals,
 * TTC rounded to the centime. Owner-side revenue surfaces are out of scope (they stay plain).
 */

/** TVA (Tunisie) — the ONLY place the 19% rate lives. */
export const TVA_RATE = 0.19;

const fr = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });

/** « 1 000 » / « 1 190,5 » — fr-FR grouping, max 2 decimals, no forced trailing zeros. */
export const formatTnd = (amount: number): string => fr.format(amount);

/** The TTC of an HT amount, rounded to the centime. */
export const ttcFromHt = (amountHt: number): number =>
  Math.round(amountHt * (1 + TVA_RATE) * 100) / 100;

/** « 1 000 TND HT (1 190 TND TTC) » — the full label every advertiser montant renders. */
export const htTtcLabel = (amountHt: number): string =>
  `${formatTnd(amountHt)} TND HT (${formatTnd(ttcFromHt(amountHt))} TND TTC)`;

/** The parenthetical alone — for surfaces whose main figure is already rendered big. */
export const ttcParenthetical = (amountHt: number): string =>
  `(${formatTnd(ttcFromHt(amountHt))} TND TTC)`;

/** A nullable montant: null renders « — » (no phantom defaults — Mejri item 6), else HT (TTC). */
export const htTtcOrDash = (amountHt: number | null | undefined): string =>
  amountHt == null ? '—' : htTtcLabel(amountHt);
