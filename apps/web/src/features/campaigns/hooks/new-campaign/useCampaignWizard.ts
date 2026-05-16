import { useCallback, useMemo, useState } from 'react';

import { campaignService } from '@/features/campaigns/services/campaign.service';
import { useCartStore } from '@/features/campaigns/stores/cart.store';
import { useWizard } from '@/hooks/useWizard';
import { supabase } from '@/lib/supabase';
import { balanceService } from '@/services/balance.service';

import {
  performAddToCart,
  performSaveDraft,
  type AddToCartDeps,
  type AddToCartOptions,
} from './wizard-serialize';
import { canStepBeReached, getStepList } from './wizard-steps';
import type {
  AddToCartResult,
  SaveDraftResult,
  UseCampaignWizardOptions,
  UseCampaignWizardReturn,
  WizardState,
} from './wizard-types';

async function revertCampaignToDraft(campaignId: string): Promise<{ error: unknown }> {
  const { error } = await supabase
    .from('campaigns')
    .update({ status: 'draft' })
    .eq('id', campaignId);
  return { error };
}

/**
 * Campaign-wizard state + navigation + persistence. Composes the generic
 * useWizard for the step index; owns WizardState; exposes pure-tested
 * saveDraft / addToCart wrappers that thread the runtime services through.
 *
 * Consumers pass `initialState` (fresh blank or reconstructed from edit
 * mode) and the few non-state inputs the persistence layer needs
 * (cpmTnd, eventId, eventName, clientRequired, fallbackLocation).
 */
export function useCampaignWizard(opts: UseCampaignWizardOptions): UseCampaignWizardReturn {
  const [state, setStateImpl] = useState<WizardState>(opts.initialState);

  const setState = useCallback((updater: (prev: WizardState) => WizardState) => {
    setStateImpl(updater);
  }, []);

  const stepList = useMemo(
    () => getStepList(opts.campaignType, { clientRequired: opts.clientRequired }),
    [opts.campaignType, opts.clientRequired],
  );
  const totalSteps = stepList.length;

  const canGoToStep = useCallback(
    (n: number): boolean => canStepBeReached(state, n, stepList),
    [state, stepList],
  );

  const canNavigateTo = useCallback(
    (stepId: number, _currentStep: number): boolean => canGoToStep(stepId),
    [canGoToStep],
  );

  const wiz = useWizard({ totalSteps, canNavigateTo });

  const serializeOpts = useMemo(
    () => ({
      campaignType: opts.campaignType,
      cpmTnd: opts.cpmTnd,
      eventId: opts.eventId,
      fallbackLocation: opts.fallbackLocation,
    }),
    [opts.campaignType, opts.cpmTnd, opts.eventId, opts.fallbackLocation],
  );

  const saveDraft = useCallback(async (): Promise<SaveDraftResult> => {
    const result = await performSaveDraft({
      state,
      options: serializeOpts,
      deps: {
        saveCampaignDraft: (data, campaignId) =>
          campaignService.saveCampaignDraft(data, campaignId) as Promise<{ id: string }>,
      },
    });
    if (result.kind === 'success' && !state.draftCampaignId) {
      setStateImpl((prev) => ({ ...prev, draftCampaignId: result.id }));
    }
    return result;
  }, [state, serializeOpts]);

  const addToCart = useCallback(async (): Promise<AddToCartResult> => {
    const addToCartOptions: AddToCartOptions = {
      ...serializeOpts,
      eventName: opts.eventName,
    };
    const deps: AddToCartDeps = {
      saveCampaignDraft: (data, campaignId) =>
        campaignService.saveCampaignDraft(data, campaignId) as Promise<{ id: string }>,
      checkCampaignBalance: (campaignId) => balanceService.checkCampaignBalance(campaignId),
      revertToDraft: revertCampaignToDraft,
      addCartItem: (item) => useCartStore.getState().addItem(item),
    };
    const result = await performAddToCart({ state, options: addToCartOptions, deps });
    if (result.kind === 'success' && !state.draftCampaignId) {
      setStateImpl((prev) => ({ ...prev, draftCampaignId: result.campaignId }));
    }
    return result;
  }, [state, serializeOpts, opts.eventName]);

  return {
    state,
    setState,
    currentStep: wiz.currentStep,
    totalSteps,
    stepList,
    goToStep: wiz.goToStep,
    nextStep: wiz.nextStep,
    prevStep: wiz.prevStep,
    canGoToStep,
    saveDraft,
    addToCart,
  };
}
