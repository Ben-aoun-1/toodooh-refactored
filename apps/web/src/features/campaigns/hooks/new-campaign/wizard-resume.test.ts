import { describe, expect, it } from 'vitest';

import { clampResumeStep, deriveResumeStep, resolveResumeStep } from './wizard-resume';
import { getStepList } from './wizard-steps';
import type { WizardState } from './wizard-types';

// CF-Q2 (spec §3.3) / CF-W1 (6 steps) — where « Reprendre » reopens a draft: stored step
// (clamped) beats derivation; derivation = the first failing gate, else the last step.
// Registry: 1 Nom et type · 2 Catégories · 3 Période · 4 Couverture · 5 Création · 6 Validation.

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
  it('a blank draft resumes at Nom et type (1)', () => {
    expect(deriveResumeStep(state({ campaignName: '' }), steps)).toBe(1);
  });

  it('a named draft with NO dates resumes at Période (3) — CF-W1: dates moved there', () => {
    expect(deriveResumeStep(state({ startDate: null, endDate: null }), steps)).toBe(3);
    expect(deriveResumeStep(state({ startDate: '2026-08-21', endDate: '2026-08-03' }), steps)).toBe(
      3,
    );
  });

  it('named + dated but no creative resumes at Création (5)', () => {
    expect(deriveResumeStep(state(), steps)).toBe(5);
  });

  it('creative linked but no budget resumes at Validation (6)', () => {
    expect(deriveResumeStep(state({ creativeId: 'cr-1', requestedBudget: null }), steps)).toBe(6);
  });

  it('a fully complete draft resumes at the FINAL step (6)', () => {
    expect(deriveResumeStep(state({ creativeId: 'cr-1' }), steps)).toBe(6);
  });
});

describe('clampResumeStep (a stored step never exceeds what the data can reach)', () => {
  it('keeps a stored step that is still reachable', () => {
    expect(clampResumeStep(3, state(), steps)).toBe(3);
  });

  it('clamps a stored step past the first failing gate down to it', () => {
    expect(clampResumeStep(6, state(), steps)).toBe(5); // creative missing → max 5
    expect(clampResumeStep(4, state({ startDate: null }), steps)).toBe(3);
    expect(clampResumeStep(5, state({ campaignName: '' }), steps)).toBe(1);
  });

  it('OLD 5-step localStorage indices (prod pre-CF-W1) clamp SAFELY into the 6-step registry', () => {
    // Old "5" (the old cart) on a complete draft → 5 (now Création): in-range, reachable, no crash.
    expect(clampResumeStep(5, state({ creativeId: 'cr-1' }), steps)).toBe(5);
    // Old "5" on a creative-less draft → clamped to the Création gate (5).
    expect(clampResumeStep(5, state(), steps)).toBe(5);
    // Old "2" (old targeting) still lands on a valid step (2 — Catégories).
    expect(clampResumeStep(2, state(), steps)).toBe(2);
    // Degenerate values stay in-range.
    expect(clampResumeStep(0, state(), steps)).toBe(1);
    expect(clampResumeStep(99, state({ creativeId: 'cr-1' }), steps)).toBe(6);
  });
});

describe('resolveResumeStep (stored beats derivation)', () => {
  it('uses the stored step when present (clamped)', () => {
    expect(resolveResumeStep(2, state(), steps)).toBe(2);
    expect(resolveResumeStep(6, state(), steps)).toBe(5);
  });

  it('derives when nothing is stored', () => {
    expect(resolveResumeStep(undefined, state(), steps)).toBe(5);
    expect(resolveResumeStep(undefined, state({ creativeId: 'cr-1' }), steps)).toBe(6);
  });
});
