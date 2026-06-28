import type { StepDescriptor, WizardState } from './wizard-types';

/** Basics gate: a name and a valid date range (start strictly before end). */
export function validateBasics(state: WizardState): boolean {
  if (!state.campaignName.trim()) return false;
  if (!state.startDate || !state.endDate) return false;
  return state.startDate < state.endDate;
}

/**
 * Targeting is OPTIONAL and persisted independently by CampaignTargetingPanel (a replace-set PUT on
 * the draft). Navigation past it is always allowed — the Basics gate already enforced the draft, and
 * an advertiser may legitimately target the whole network (no lines).
 */
export function validateTargeting(_state: WizardState): boolean {
  return true;
}

/** Creative gate: a creative must be linked (PATCH creative_id) before budgeting/submit. */
export function validateCreative(state: WizardState): boolean {
  return Boolean(state.creativeId);
}

/** Cart gate: a positive indicative budget (TND). */
export function validateCart(state: WizardState): boolean {
  return state.requestedBudget != null && state.requestedBudget > 0;
}

const STEP_TEMPLATE: ReadonlyArray<Omit<StepDescriptor, 'validate'>> = [
  { index: 1, id: 'basics', label: 'Informations de base' },
  { index: 2, id: 'targeting', label: 'Ciblage' },
  { index: 3, id: 'creative', label: 'Création' },
  { index: 4, id: 'cart', label: 'Budget & validation' },
];

export function getStepList(): StepDescriptor[] {
  const validators: Record<string, (state: WizardState) => boolean> = {
    basics: validateBasics,
    targeting: validateTargeting,
    creative: validateCreative,
    cart: validateCart,
  };
  return STEP_TEMPLATE.map((s) => ({ ...s, validate: validators[s.id] }));
}

/**
 * Pure predicate: `stepIndex` is reachable iff it is in-range and every prior step's validator passes
 * against `state` — a step opens only when all gates before it close.
 */
export function canStepBeReached(
  state: WizardState,
  stepIndex: number,
  stepList: StepDescriptor[],
): boolean {
  if (stepIndex < 1 || stepIndex > stepList.length) return false;
  for (let i = 0; i < stepIndex - 1; i++) {
    if (!stepList[i].validate(state)) return false;
  }
  return true;
}
