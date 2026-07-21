import { describe, expect, it } from 'vitest';

import {
  BUDGET_FLOOR_ERROR,
  CAMPAIGN_BUDGET_FLOOR_TND,
  CMAX_PULLBACK_NOTICE,
  CMAX_ZERO_STATE,
  clampBudgetToCmax,
  cmaxHelperLine,
  isBudgetBelowMinimum,
  isBudgetExceedsCmax,
  isInventoryInsufficient,
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

  it('a sub-floor ceiling with a higher budget: the budget CLEARS (insufficient inventory owns the step)', () => {
    expect(clampBudgetToCmax(300, 0)).toEqual({ next: null, clamped: true });
    expect(clampBudgetToCmax(300, 99)).toEqual({ next: null, clamped: true });
  });

  it('CF-U3 — a stored sub-floor budget is NEVER auto-raised (the submit gate owns it)', () => {
    expect(clampBudgetToCmax(50, 540)).toEqual({ next: 50, clamped: false });
  });
});

describe('the 100 TND floor (CF-U3 — mirrors the api MIN_CAMPAIGN_BUDGET_TND)', () => {
  it('constant + insufficiency threshold', () => {
    expect(CAMPAIGN_BUDGET_FLOOR_TND).toBe(100);
    expect(isInventoryInsufficient(99)).toBe(true);
    expect(isInventoryInsufficient(100)).toBe(false);
    expect(isInventoryInsufficient(0)).toBe(true);
  });

  it('the server refusal detector + the French message', () => {
    expect(isBudgetBelowMinimum({ code: 'BUDGET_BELOW_MINIMUM', message: 'x' })).toBe(true);
    expect(isBudgetBelowMinimum({ code: 'BUDGET_EXCEEDS_CMAX', message: 'x' })).toBe(false);
    expect(BUDGET_FLOOR_ERROR).toBe("Le budget minimum d'une campagne est de 100 TND.");
  });
});

describe('cmaxHelperLine — ceiling AND floor said out loud (CF-U3)', () => {
  it('works the floor + eligible count in, singular and plural', () => {
    expect(cmaxHelperLine(540, 1)).toBe(
      "Budget maximum disponible : 540 TND (minimum : 100 TND) — calculé sur l'inventaire réel de votre ciblage (1 établissement éligible).",
    );
    // The thousands separator is the fr-TN runtime's (NBSP variants differ per ICU) — pin via
    // the same formatter rather than a literal.
    const int = new Intl.NumberFormat('fr-TN', { maximumFractionDigits: 0 });
    expect(cmaxHelperLine(1080, 2)).toBe(
      `Budget maximum disponible : ${int.format(1080)} TND (minimum : 100 TND) — calculé sur l'inventaire réel de votre ciblage (2 établissements éligibles).`,
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
