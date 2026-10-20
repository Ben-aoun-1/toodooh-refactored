import { describe, expect, it } from 'vitest';

import { designFontPx, posterNameFontSize } from './poster-fit';

describe('POSTER-FIT — a club name fits its poster column', () => {
  it('keeps the design size steps', () => {
    expect(designFontPx('Arsenal', 25)).toBe(25);
    expect(designFontPx('Manchester City', 25)).toBe(22);
    expect(designFontPx('Paris Saint-Germain', 25)).toBe(19);
  });

  it('caps by the longest word: one long word gets less room than two short ones', () => {
    // LIVERPOOL (9 letters) on a card: 30 / (9 × 0.72) = 4.63 cqw → 13 px on a 280 px card.
    expect(posterNameFontSize('Liverpool', 25, 'card')).toBe('min(25px, 4.63cqw)');
    // « Real Madrid » wraps between its words: the longer word (6) sets the cap.
    expect(posterNameFontSize('Real Madrid', 25, 'card')).toBe('min(25px, 6.94cqw)');
    expect(posterNameFontSize('Liverpool', 40, 'hero')).toBe('min(40px, 5.25cqw)');
  });
});
