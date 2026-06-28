import type {
  CampaignView,
  CreateCampaignInput,
  UpdateCampaignInput,
} from '@/features/campaigns/services/campaigns.api';

import type { CreateDraftResult, SubmitResult, WizardState } from './wizard-types';

export interface CreateDraftDeps {
  create: (input: CreateCampaignInput) => Promise<CampaignView>;
}

export interface SubmitDeps {
  update: (id: string, input: UpdateCampaignInput) => Promise<CampaignView>;
  submit: (id: string) => Promise<CampaignView>;
}

/**
 * Pure serializer: the create-early payload from WizardState. campaign_type is fixed to 'standard'
 * (the de-Supabase wizard's only flow); dates are the ISO calendar strings the API expects.
 */
export function serializeCreate(state: WizardState): CreateCampaignInput {
  return {
    name: state.campaignName.trim(),
    campaign_type: 'standard',
    start_date: state.startDate,
    end_date: state.endDate,
  };
}

/**
 * Create-early: validate the Basics fields, then POST /api/campaigns. The caller (the hook) threads
 * the returned id into state.draftCampaignId so targeting/creative/budget can attach to it.
 */
export async function performCreateDraft(args: {
  state: WizardState;
  deps: CreateDraftDeps;
}): Promise<CreateDraftResult> {
  const { state, deps } = args;
  if (!state.campaignName.trim()) {
    return { kind: 'error', error: new Error('Le nom de la campagne est obligatoire') };
  }
  if (!state.startDate || !state.endDate) {
    return { kind: 'error', error: new Error('Les dates de début et fin sont obligatoires') };
  }
  if (state.startDate >= state.endDate) {
    return {
      kind: 'error',
      error: new Error('La date de début doit être antérieure à la date de fin'),
    };
  }
  try {
    const created = await deps.create(serializeCreate(state));
    if (!created || typeof created.id !== 'string') {
      return {
        kind: 'error',
        error: new Error('La création de la campagne n’a pas renvoyé d’identifiant'),
      };
    }
    return { kind: 'success', id: created.id };
  } catch (e) {
    return { kind: 'error', error: e instanceof Error ? e : new Error(String(e)) };
  }
}

/**
 * Interim cart submit: PATCH the indicative requested_budget onto the draft, then POST /:id/submit
 * (draft → pending). Requires the create-early draft and a positive budget — both gated by the step
 * validators, re-checked here so the function is safe to call directly.
 */
export async function performSubmit(args: {
  state: WizardState;
  deps: SubmitDeps;
}): Promise<SubmitResult> {
  const { state, deps } = args;
  if (!state.draftCampaignId) {
    return { kind: 'error', error: new Error('La campagne n’a pas encore été créée') };
  }
  if (state.requestedBudget == null || state.requestedBudget <= 0) {
    return { kind: 'error', error: new Error('Le budget doit être supérieur à 0 dinar') };
  }
  try {
    await deps.update(state.draftCampaignId, { requested_budget: state.requestedBudget });
    const campaign = await deps.submit(state.draftCampaignId);
    return { kind: 'success', campaign };
  } catch (e) {
    return { kind: 'error', error: e instanceof Error ? e : new Error(String(e)) };
  }
}
