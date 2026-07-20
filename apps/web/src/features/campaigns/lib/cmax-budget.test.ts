import { describe, expect, it } from 'vitest';

import {
  CMAX_PULLBACK_NOTICE,
  CMAX_ZERO_STATE,
  clampBudgetToCmax,
  cmaxHelperLine,
  isBudgetExceedsCmax,
} from './cmax-budget';

// E5 (VF US-1.4) — the pure cursor-vs-ceiling rules behind the bounded Validation slider.

describe('clampBudgetToCmax — the pull-back', () => {
  it('under the ceiling: untouched, no notice', () => {
    expect(clampBudgetToCmax(300, 540)).toEqual({ next: 300, clamped: false });
  });

  it('AT the ceiling: untouched (the boundary is inclusive, mirroring the submit gate)', () => {
    expect(clampBudgetToCmax(540, 540)).toEqual({ next: 540, clamped: false });
  });

  it('over the ceiling: clamped DOWN to it, notice required', () => {
    expect(clampBudgetToCmax(5000, 540)).toEqual({ next: 540, clamped: true });
  });

  it('null budget: nothing to clamp', () => {
    expect(clampBudgetToCmax(null, 540)).toEqual({ next: null, clamped: false });
    expect(clampBudgetToCmax(null, 0)).toEqual({ next: null, clamped: false });
  });

  it('zero ceiling with a set budget: the budget CLEARS (0 is not a valid budget)', () => {
    expect(clampBudgetToCmax(300, 0)).toEqual({ next: null, clamped: true });
  });
});

describe('cmaxHelperLine — the ceiling said out loud', () => {
  it('works the eligible count in, singular and plural', () => {
    expect(cmaxHelperLine(540, 1)).toBe(
      "Budget maximum disponible : 540 TND — calculé sur l'inventaire réel de votre ciblage (1 établissement éligible).",
    );
    // The thousands separator is the fr-TN runtime's (NBSP variants differ per ICU) — pin via
    // the same formatter rather than a literal.
    const int = new Intl.NumberFormat('fr-TN', { maximumFractionDigits: 0 });
    expect(cmaxHelperLine(1080, 2)).toBe(
      `Budget maximum disponible : ${int.format(1080)} TND — calculé sur l'inventaire réel de votre ciblage (2 établissements éligibles).`,
    );
  });
});

describe('isBudgetExceedsCmax — the submit-refusal detector', () => {
  it('matches the server error code and nothing else', () => {
    expect(isBudgetExceedsCmax({ code: 'BUDGET_EXCEEDS_CMAX', message: 'x' })).toBe(true);
    expect(isBudgetExceedsCmax({ code: 'MISSING_BUDGET', message: 'x' })).toBe(false);
    expect(isBudgetExceedsCmax(new Error('network'))).toBe(false);
    expect(isBudgetExceedsCmax(null)).toBe(false);
  });
});

describe('the French copy (pinned)', () => {
  it('notice + zero-state read exactly as chartered', () => {
    expect(CMAX_PULLBACK_NOTICE).toBe('Le budget a été ajusté à l’inventaire disponible.');
    expect(CMAX_ZERO_STATE).toBe(
      'Aucun inventaire disponible pour ce ciblage — élargissez vos catégories ou zones.',
    );
  });
});
