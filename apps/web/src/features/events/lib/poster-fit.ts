/**
 * POSTER-FIT (Myriam 2026-10-20) — a club name on a match poster must fit its column. It was drawn
 * at a fixed size (25 px on a card): a long name in a narrow card (the 280 px suggestion grid)
 * could not wrap — one word — and the poster's overflow cut it (« IVERPOC 17h30 ARSENAL »).
 *
 * The size is now the SMALLER of the design size and what the column can hold, the column being a
 * share of the poster's own width (a CSS container, `cqw`). An uppercase extra-bold letter is about
 * 0.72 em wide; a team's column is about 30 % of a card poster (two columns around the kickoff box)
 * and 34 % of the hero poster.
 */
const LETTER_EM = 0.72;
const COLUMN_SHARE = { card: 30, hero: 34 } as const;

/** The design size, as before: long names a step smaller, national teams smaller still. */
export const designFontPx = (name: string, base: number): number =>
  name.length > 16 ? base - 6 : name.length > 11 ? base - 3 : base;

/** The CSS font-size for a club name: `min(<design>px, <fit>cqw)`. */
export function posterNameFontSize(name: string, basePx: number, variant: 'card' | 'hero'): string {
  const longestWord = Math.max(
    1,
    ...name
      .trim()
      .split(/\s+/)
      .map((w) => w.length),
  );
  const fitCqw = COLUMN_SHARE[variant] / (longestWord * LETTER_EM);
  return `min(${designFontPx(name, basePx)}px, ${fitCqw.toFixed(2)}cqw)`;
}
