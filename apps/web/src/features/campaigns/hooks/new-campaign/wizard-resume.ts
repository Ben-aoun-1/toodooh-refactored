import type { StepDescriptor, WizardState } from './wizard-types';

// CF-Q2 (spec §3.3) — where « Reprendre » reopens a draft. A stored (same-device) step wins,
// clamped to what the loaded data can actually reach; with no stored step the wizard derives the
// first step whose gate fails (else the final step) from the campaign itself.

/**
 * The first step whose validator FAILS against `state` — else the final step. Because a step is
 * reachable iff every PRIOR gate passes, this is also the maximum reachable step.
 */
export function deriveResumeStep(state: WizardState, stepList: StepDescriptor[]): number {
  for (const step of stepList) {
    if (!step.validate(state)) return step.index;
  }
  return stepList.length;
}

/** Clamp a stored step into [1, maximum reachable] for the loaded draft. */
export function clampResumeStep(
  stored: number,
  state: WizardState,
  stepList: StepDescriptor[],
): number {
  return Math.min(Math.max(1, stored), deriveResumeStep(state, stepList));
}

/** The step to open the wizard at: exact same-device resume when stored, else derivation. */
export function resolveResumeStep(
  stored: number | undefined,
  state: WizardState,
  stepList: StepDescriptor[],
): number {
  return stored === undefined
    ? deriveResumeStep(state, stepList)
    : clampResumeStep(stored, state, stepList);
}
