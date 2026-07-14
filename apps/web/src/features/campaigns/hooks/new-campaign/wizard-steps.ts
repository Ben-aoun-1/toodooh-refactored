import type { StepDescriptor, WizardState } from './wizard-types';

/** Basics gate (CF-W1 « Nom et type »): a name. The type chips are UI-only (Réseau Toodooh
 * locked active, Parc TV grayed) — nothing to validate, nothing persisted. Dates moved to the
 * dedicated Période step. */
export function validateBasics(state: WizardState): boolean {
  return Boolean(state.campaignName.trim());
}

/** Période gate: a valid date range (start strictly before end). */
export function validateDates(state: WizardState): boolean {
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

/**
 * Couverture is a read-only coverage-map PREVIEW (the screenhosts matching the targeting). It gates
 * nothing — like Targeting, navigation past it is always allowed.
 */
export function validateCoverage(_state: WizardState): boolean {
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

// CF-W1 (spec §1.2) — the 6-step order: name+type first, categories second, dates third.
const STEP_TEMPLATE: ReadonlyArray<Omit<StepDescriptor, 'validate'>> = [
  { index: 1, id: 'basics', label: 'Nom et type' },
  { index: 2, id: 'targeting', label: 'Catégories' },
  { index: 3, id: 'dates', label: 'Période' },
  { index: 4, id: 'coverage', label: 'Couverture' },
  { index: 5, id: 'creative', label: 'Création' },
  { index: 6, id: 'cart', label: 'Validation' },
];

export function getStepList(): StepDescriptor[] {
  const validators: Record<string, (state: WizardState) => boolean> = {
    basics: validateBasics,
    targeting: validateTargeting,
    dates: validateDates,
    coverage: validateCoverage,
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
