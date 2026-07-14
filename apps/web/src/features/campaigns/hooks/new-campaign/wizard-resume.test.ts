import { describe, expect, it } from 'vitest';

import { clampResumeStep, deriveResumeStep, resolveResumeStep } from './wizard-resume';
import { getStepList } from './wizard-steps';
import type { WizardState } from './wizard-types';

// CF-Q2 (spec §3.3) — where « Reprendre » reopens a draft: stored step (clamped) beats
// derivation; derivation = the first failing gate, else the last step.

const steps = getStepList();

const state = (over: Partial<WizardState> = {}): WizardState => ({
  campaignName: 'Ma campagne',
  startDate: '2026-08-03',
  endDate: '2026-08-21',
  creativeId: null,
  requestedBudget: 900,
  draftCampaignId: 'draft-1',
  ...over,
});

describe('deriveResumeStep (fallback: the first incomplete step, else the last)', () => {
  it('a blank draft resumes at Basics (1)', () => {
    expect(
      deriveResumeStep(state({ campaignName: '', startDate: null, endDate: null }), steps),
    ).toBe(1);
  });

  it('invalid dates (start ≥ end) also hold the draft at Basics', () => {
    expect(deriveResumeStep(state({ startDate: '2026-08-21', endDate: '2026-08-03' }), steps)).toBe(
      1,
    );
  });

  it('valid basics but no creative resumes at Création (4) — targeting/coverage never gate', () => {
    expect(deriveResumeStep(state(), steps)).toBe(4);
  });

  it('creative linked but no budget resumes at Validation (5)', () => {
    expect(deriveResumeStep(state({ creativeId: 'cr-1', requestedBudget: null }), steps)).toBe(5);
  });

  it('a fully complete draft resumes at the FINAL step (5)', () => {
    expect(deriveResumeStep(state({ creativeId: 'cr-1' }), steps)).toBe(5);
  });
});

describe('clampResumeStep (a stored step never exceeds what the data can reach)', () => {
  it('keeps a stored step that is still reachable', () => {
    expect(clampResumeStep(3, state(), steps)).toBe(3);
  });

  it('clamps a stored step past the first failing gate down to it', () => {
    expect(clampResumeStep(5, state(), steps)).toBe(4); // creative missing → max 4
    expect(clampResumeStep(4, state({ campaignName: '' }), steps)).toBe(1);
  });

  it('clamps out-of-range values into [1, last]', () => {
    expect(clampResumeStep(0, state(), steps)).toBe(1);
    expect(clampResumeStep(99, state({ creativeId: 'cr-1' }), steps)).toBe(5);
  });
});

describe('resolveResumeStep (stored beats derivation)', () => {
  it('uses the stored step when present (clamped)', () => {
    expect(resolveResumeStep(2, state(), steps)).toBe(2);
    expect(resolveResumeStep(5, state(), steps)).toBe(4);
  });

  it('derives when nothing is stored', () => {
    expect(resolveResumeStep(undefined, state(), steps)).toBe(4);
    expect(resolveResumeStep(undefined, state({ creativeId: 'cr-1' }), steps)).toBe(5);
  });
});
