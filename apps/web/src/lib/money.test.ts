import { describe, expect, it } from 'vitest';

import { TVA_RATE, formatTnd, htTtcLabel, htTtcOrDash, ttcFromHt, ttcParenthetical } from './money';

// CF-U1 (Mejri item 6) — the ONE money formatter: fr-FR spacing, ≤2 decimals, TTC = HT × 1.19
// rounded to the centime. The 19% rate lives in TVA_RATE and NOWHERE else (grep-pinned in CF-9).
// fr-FR groups thousands with NARROW NO-BREAK SPACE (U+202F) — assertions normalize it.
const plain = (s: string): string => s.replace(/[\u202f\u00a0]/g, ' ');

describe('money lib (CF-U1 — HT/TTC single home)', () => {
  it('pins the TVA rate at 19%', () => {
    expect(TVA_RATE).toBe(0.19);
  });

  it('formats fr-FR with grouped thousands and at most 2 decimals', () => {
    expect(plain(formatTnd(1000))).toBe('1 000');
    expect(plain(formatTnd(1190))).toBe('1 190');
    expect(plain(formatTnd(1234.5))).toBe('1 234,5');
    expect(plain(formatTnd(0))).toBe('0');
  });

  it('TTC = HT × 1.19, rounded to the centime (2 decimals)', () => {
    expect(ttcFromHt(1000)).toBe(1190);
    expect(ttcFromHt(50)).toBe(59.5);
    expect(ttcFromHt(33.33)).toBe(39.66); // 39.6627 → centime rounding
    expect(ttcFromHt(0)).toBe(0);
  });

  it('renders the mockup label « 1 000 TND HT (1 190 TND TTC) »', () => {
    expect(plain(htTtcLabel(1000))).toBe('1 000 TND HT (1 190 TND TTC)');
    expect(plain(htTtcLabel(50))).toBe('50 TND HT (59,5 TND TTC)');
  });

  it('renders the parenthetical alone for big-figure surfaces', () => {
    expect(plain(ttcParenthetical(1000))).toBe('(1 190 TND TTC)');
  });

  it('a NULL montant renders « — » (no phantom defaults — Mejri item 6)', () => {
    expect(htTtcOrDash(null)).toBe('—');
    expect(htTtcOrDash(undefined)).toBe('—');
    expect(plain(htTtcOrDash(1000))).toBe('1 000 TND HT (1 190 TND TTC)');
  });
});
