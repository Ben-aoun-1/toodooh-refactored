import { useCallback, useMemo, useState } from 'react';

import { useWizard } from '@/hooks/useWizard';

import { performCreateDraft, performSubmit } from './wizard-serialize';
import { canStepBeReached, getStepList } from './wizard-steps';
import type {
  CreateDraftResult,
  SubmitResult,
  UseCampaignWizardOptions,
  UseCampaignWizardReturn,
  WizardState,
} from './wizard-types';

/**
 * Campaign-wizard state + navigation + persistence on the campaigns REST engine.
 *
 * The hook owns WizardState and composes the generic useWizard for the step index. It implements
 * CREATE-EARLY: the first forward move past Basics POSTs the draft (idempotent `ensureDraft`) and
 * threads the id into state, so the targeting / creative / cart panels all attach to a real draft.
 * Navigation past Basics therefore awaits the draft create; `goToStep` / `nextStep` are async.
 *
 * The runtime REST calls are injected (`createDraft` / `updateCampaign` / `submitCampaign`) so the
 * pure persistence helpers (performCreateDraft / performSubmit) stay unit-testable.
 */
export function useCampaignWizard(opts: UseCampaignWizardOptions): UseCampaignWizardReturn {
  const [state, setStateImpl] = useState<WizardState>(opts.initialState);
  const [creatingDraft, setCreatingDraft] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const setState = useCallback((updater: (prev: WizardState) => WizardState) => {
    setStateImpl(updater);
  }, []);

  const stepList = useMemo(() => getStepList(), []);
  const totalSteps = stepList.length;

  // Pure breadcrumb enabled-state — validators only. The create-early draft requirement for steps
  // beyond Basics is enforced procedurally in goToStep, not here (so the predicate stays pure and the
  // breadcrumb does not flicker on the async draft write).
  const canGoToStep = useCallback(
    (n: number): boolean => canStepBeReached(state, n, stepList),
    [state, stepList],
  );

  // useWizard drives only the index; we re-validate ourselves and advance via its raw setter so the
  // async draft-create can complete before the move (avoiding a stale-closure predicate race).
  const wiz = useWizard({ totalSteps });

  const { createDraft, updateCampaign, submitCampaign } = opts;

  const ensureDraft = useCallback(async (): Promise<CreateDraftResult> => {
    if (state.draftCampaignId) return { kind: 'success', id: state.draftCampaignId };
    setCreatingDraft(true);
    try {
      const result = await performCreateDraft({ state, deps: { create: createDraft } });
      if (result.kind === 'success') {
        setStateImpl((prev) => ({ ...prev, draftCampaignId: result.id }));
      }
      return result;
    } finally {
      setCreatingDraft(false);
    }
  }, [state, createDraft]);

  const goToStep = useCallback(
    async (target: number): Promise<boolean> => {
      if (target < 1 || target > totalSteps) return false;
      if (!canStepBeReached(state, target, stepList)) return false;
      // A move past Basics requires the create-early draft to exist.
      if (target > 1 && !state.draftCampaignId) {
        const created = await ensureDraft();
        if (created.kind !== 'success') return false;
      }
      wiz.setCurrentStep(target);
      return true;
    },
    [state, stepList, totalSteps, ensureDraft, wiz],
  );

  const nextStep = useCallback(
    (): Promise<boolean> => goToStep(wiz.currentStep + 1),
    [goToStep, wiz],
  );

  const prevStep = useCallback((): boolean => {
    const target = wiz.currentStep - 1;
    if (target < 1) return false;
    wiz.setCurrentStep(target);
    return true;
  }, [wiz]);

  const submit = useCallback(async (): Promise<SubmitResult> => {
    setSubmitting(true);
    try {
      return await performSubmit({
        state,
        deps: { update: updateCampaign, submit: submitCampaign },
      });
    } finally {
      setSubmitting(false);
    }
  }, [state, updateCampaign, submitCampaign]);

  return {
    state,
    setState,
    currentStep: wiz.currentStep,
    totalSteps,
    stepList,
    goToStep,
    nextStep,
    prevStep,
    canGoToStep,
    ensureDraft,
    submit,
    creatingDraft,
    submitting,
  };
}
