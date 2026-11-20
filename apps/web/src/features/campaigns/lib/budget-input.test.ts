import { describe, expect, it } from 'vitest';

import { budgetInputText, parseBudgetInput } from './budget-input';

describe('the typed cart budget', () => {
  it('accepts spaces, a comma or a dot, at most 2 decimals, within the maximum', () => {
    expect(parseBudgetInput('15 619', 36656.8)).toEqual({ ok: true, value: 15619 });
    expect(parseBudgetInput('15619,5', 36656.8)).toEqual({ ok: true, value: 15619.5 });
    expect(parseBudgetInput('36656.8', 36656.8)).toEqual({ ok: true, value: 36656.8 });
    expect(parseBudgetInput('1 000 TND', undefined)).toEqual({ ok: true, value: 1000 });
  });

  it('says why it refuses', () => {
    expect(parseBudgetInput('', 100)).toMatchObject({
      ok: false,
      error: expect.stringContaining('Indiquez'),
    });
    expect(parseBudgetInput('12,345', 100)).toMatchObject({
      ok: false,
      error: expect.stringContaining('2 décimales'),
    });
    expect(parseBudgetInput('abc', 100)).toMatchObject({ ok: false });
    expect(parseBudgetInput('0', 100)).toMatchObject({
      ok: false,
      error: expect.stringContaining('supérieur à 0'),
    });
    expect(parseBudgetInput('40000', 36656.8)).toMatchObject({
      ok: false,
      error: expect.stringMatching(/^Au maximum 36\s656,8 TND/),
    });
  });

  it('the box mirrors the cursor', () => {
    expect(budgetInputText(null)).toBe('');
    expect(budgetInputText(15619)).toMatch(/^15\s619$/);
  });
});
