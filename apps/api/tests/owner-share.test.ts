import { describe, expect, it } from 'vitest';

import { ownerShareTnd } from '../src/lib/owner-share.js';
import { DEFAULT_REVERSEMENT_PCTS } from '../src/lib/reversement/split.js';

// Operator ruling 2026-10-09 — the screenhost sees its share (50 % of the HT value) as TTC.
describe('ownerShareTnd — the screenhost money', () => {
  it('100 TND HT paid → 50 TND (the operator example)', () => {
    expect(ownerShareTnd(100, DEFAULT_REVERSEMENT_PCTS)).toBe(50);
  });

  it('floors to the millime exactly like the settlement split', () => {
    expect(ownerShareTnd(6.185, DEFAULT_REVERSEMENT_PCTS)).toBe(3.092);
    expect(ownerShareTnd(0.001, DEFAULT_REVERSEMENT_PCTS)).toBe(0);
  });

  it('follows a recalibrated split', () => {
    expect(ownerShareTnd(100, { sh: 60, toodooh: 34, agentSh: 3, agentSc: 3 })).toBe(60);
  });

  it('a missing or non-positive value is 0, never a throw', () => {
    expect(ownerShareTnd(0, DEFAULT_REVERSEMENT_PCTS)).toBe(0);
    expect(ownerShareTnd(-5, DEFAULT_REVERSEMENT_PCTS)).toBe(0);
    expect(ownerShareTnd(Number.NaN, DEFAULT_REVERSEMENT_PCTS)).toBe(0);
  });
});
