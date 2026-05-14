import type { StepDescriptor, WizardState } from './wizard-types';

/** Translated literally from NewCampaign.tsx canProceedToStep2 (L913). */
export function validateNameType(state: WizardState): boolean {
  return Boolean(state.campaignName.trim() && state.diffusionType);
}

/** Translated literally from NewCampaign.tsx canLeaveStep2 (L917). */
export function validateCategoryOrParc(state: WizardState, clientRequired: boolean): boolean {
  if (state.diffusionType === 'parc_tv') return state.selectedParcIds.length > 0;
  if (state.categories.length === 0) return false;
  if (clientRequired) return Boolean(state.client.trim());
  return true;
}

/** Translated literally from NewCampaign.tsx canProceedToStep3 (L924). */
export function validatePeriod(state: WizardState): boolean {
  if (!state.startDate || !state.endDate) return false;
  return state.startDate < state.endDate;
}

/** Translated literally from NewCampaign.tsx canProceedToStep4 (L928). */
export function validateZones(state: WizardState): boolean {
  return (
    state.geographicZones.length > 0 &&
    state.geographicZones.some((zone) => (zone.locations || []).length > 0)
  );
}

/** Translated literally from NewCampaign.tsx canProceedToStep5 (L935). */
export function validateSpot(state: WizardState): boolean {
  return Boolean(state.uploadedVideoId || state.uploadedVideoUrl || state.existingVideoId);
}

/**
 * Translated from NewCampaign.tsx canProceedToStep6 (L939) with a documented
 * simplification: the bounds check (effectiveMin/effectiveMax) is omitted here
 * because it requires `cpmTnd` and a derived `impressionsFromSelection` that
 * isn't in WizardState (it's a server-derived useEffect output). The consuming
 * step component re-runs the bounds gate locally before enabling the cart
 * button — same shape as the existing button-disabled guard at L3146.
 */
export function validateBudget(state: WizardState): boolean {
  return state.adjustedBudget > 0 && state.calculatedImpressions > 0;
}

const STANDARD_STEP_TEMPLATE: ReadonlyArray<Omit<StepDescriptor, 'validate'>> = [
  { index: 1, id: 'name-type', label: 'Informations de base' },
  { index: 2, id: 'category', label: 'Catégorie / Parc' },
  { index: 3, id: 'period', label: 'Période' },
  { index: 4, id: 'zones', label: 'Zones géographiques' },
  { index: 5, id: 'spot', label: 'Votre spot' },
  { index: 6, id: 'validation', label: 'Validation' },
];

const EVENT_STEP_TEMPLATE: ReadonlyArray<Omit<StepDescriptor, 'validate'>> = [
  { index: 1, id: 'zones', label: 'Zones géographiques' },
  { index: 2, id: 'spot', label: 'Votre spot' },
  { index: 3, id: 'validation', label: 'Validation' },
];

export function getStepList(
  campaignType: 'standard' | 'event',
  opts: { clientRequired: boolean } = { clientRequired: false },
): StepDescriptor[] {
  if (campaignType === 'event') {
    const eventValidators: Record<string, (state: WizardState) => boolean> = {
      zones: validateZones,
      spot: validateSpot,
      validation: validateBudget,
    };
    return EVENT_STEP_TEMPLATE.map((s) => ({ ...s, validate: eventValidators[s.id] }));
  }
  const standardValidators: Record<string, (state: WizardState) => boolean> = {
    'name-type': validateNameType,
    category: (state) => validateCategoryOrParc(state, opts.clientRequired),
    period: validatePeriod,
    zones: validateZones,
    spot: validateSpot,
    validation: validateBudget,
  };
  return STANDARD_STEP_TEMPLATE.map((s) => ({ ...s, validate: standardValidators[s.id] }));
}

/**
 * Pure predicate: stepIndex is reachable iff it is in-range and all prior
 * steps' validators pass against `state`. Mirrors canNavigateToStep at
 * NewCampaign.tsx:1097 — a step is reachable when all gates up to it close.
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
