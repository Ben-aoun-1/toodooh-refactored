import { describe, expect, it } from 'vitest';

import {
  BUDGET_FLOOR_ERROR,
  CAMPAIGN_BUDGET_FLOOR_TND,
  CMAX_PULLBACK_NOTICE,
  CMAX_SATURATED_STATE,
  CMAX_ZERO_STATE,
  cmaxZeroStateMessage,
  clampBudgetToCmax,
  cmaxHelperLine,
  isBudgetBelowMinimum,
  isBudgetExceedsCmax,
  isBudgetAccepted,
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

  it('a zero ceiling with a budget: the budget CLEARS (insufficient inventory owns the step)', () => {
    expect(clampBudgetToCmax(300, 0)).toEqual({ next: null, clamped: true });
    // FLOOR-0 — a small ceiling is a real ceiling now: the budget pulls back to it.
    expect(clampBudgetToCmax(300, 99)).toEqual({ next: 99, clamped: true });
  });

  it('CF-U3 — a stored sub-floor budget is NEVER auto-raised (the submit gate owns it)', () => {
    expect(clampBudgetToCmax(50, 540)).toEqual({ next: 50, clamped: false });
  });
});

describe('FLOOR-0 — no 100 TND floor, only > 0 (mirrors the api MIN_CAMPAIGN_BUDGET_TND)', () => {
  it('constant + insufficiency threshold', () => {
    expect(CAMPAIGN_BUDGET_FLOOR_TND).toBe(0);
    expect(isInventoryInsufficient(99)).toBe(false);
    expect(isInventoryInsufficient(1)).toBe(false);
    expect(isInventoryInsufficient(0)).toBe(true);
    expect(isBudgetAccepted(0)).toBe(false);
    expect(isBudgetAccepted(null)).toBe(false);
    expect(isBudgetAccepted(5)).toBe(true);
  });

  it('the server refusal detector + the French message', () => {
    expect(isBudgetBelowMinimum({ code: 'BUDGET_BELOW_MINIMUM', message: 'x' })).toBe(true);
    expect(isBudgetBelowMinimum({ code: 'BUDGET_EXCEEDS_CMAX', message: 'x' })).toBe(false);
    expect(BUDGET_FLOOR_ERROR).toBe('Le budget de la campagne doit être supérieur à 0 TND.');
  });
});

describe('cmaxHelperLine — the ceiling said out loud (FLOOR-0: no minimum any more)', () => {
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

describe('cmaxZeroStateMessage — the CF-HF4 saturated/empty split', () => {
  it('matching-but-saturated venues speak the saturated line; nothing-matches keeps the old line', () => {
    expect(cmaxZeroStateMessage(3)).toBe(CMAX_SATURATED_STATE);
    expect(cmaxZeroStateMessage(0)).toBe(CMAX_ZERO_STATE);
    expect(cmaxZeroStateMessage(undefined)).toBe(CMAX_ZERO_STATE);
    expect(CMAX_SATURATED_STATE).toBe(
      'Inventaire momentanément saturé sur ce ciblage — réessayez avec une autre période.',
    );
  });
});
