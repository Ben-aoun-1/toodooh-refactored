/** What the pages print for a value the network does not have (never an invented number). */
export const NO_VALUE = '–';

/** The prototype's `fmt`: a rounded integer with non-breaking thousands separators. */
export function formatCount(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/** The prototype's count-up: the value shown at progress `k` (0–1) of a cubic ease-out. */
export function countUpAt(to: number, k: number): number {
  const p = Math.min(1, Math.max(0, k));
  return to * (1 - Math.pow(1 - p, 3));
}

/** « N mot » / « N mots » — the prototype's `plural`. */
export function plural(n: number, one: string, many: string): string {
  return `${n} ${n > 1 ? many : one}`;
}
