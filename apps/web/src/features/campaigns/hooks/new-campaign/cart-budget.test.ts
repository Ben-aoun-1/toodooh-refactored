import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { CART_BUDGET_MIN_TND, CART_BUDGET_STEP_TND } from './cart-budget';

// CF-HF3 (Mejri item 1) — the slider max must be EXACTLY reachable. An <input type="range"> only
// reaches min + n·step; C_max is a server-side Math.floor INTEGER, so step 1 makes every ceiling
// attainable. The old step 50 (a flat-5000-era leftover) made Mejri's max-155 dead (100 → 150).
// Nothing pinned the step before — this is the missing assertion that let E5's max-swap regress.

describe('the budget slider step (both sliders, one constant)', () => {
  it('is 1 TND — every INTEGER C_max is on the grid, Mejri’s 155 included', () => {
    expect(CART_BUDGET_STEP_TND).toBe(1);
    for (const cMax of [155, 101, 540, 4999, 100]) {
      expect((cMax - CART_BUDGET_MIN_TND) % CART_BUDGET_STEP_TND).toBe(0);
    }
  });

  it('the wizard slider rides the shared constant (pinned against the component source)', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../../pages/new-campaign/StepCart.tsx', import.meta.url)),
      'utf8',
    );
    expect(source).toContain('step={CART_BUDGET_STEP_TND}');
  });

  it('the Booster slider rides the SAME constant (the hardcoded step={10} is dead)', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../../components/BoostCampaignModal.tsx', import.meta.url)),
      'utf8',
    );
    expect(source).toContain('step={CART_BUDGET_STEP_TND}');
    expect(source).not.toContain('step={10}');
  });
});
