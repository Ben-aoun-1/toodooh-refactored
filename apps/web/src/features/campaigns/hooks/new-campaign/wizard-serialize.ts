import type {
  CampaignView,
  CreateCampaignInput,
  UpdateCampaignInput,
} from '@/features/campaigns/services/campaigns.api';

import type { CreateDraftResult, SaveDraftResult, SubmitResult, WizardState } from './wizard-types';

export interface CreateDraftDeps {
  create: (input: CreateCampaignInput) => Promise<CampaignView>;
}

/**
 * Mutable single-slot holder for an in-flight promise. A React `useRef<Promise<T> | null>` IS one of
 * these (same `{ current }` shape), so the dedup survives across renders.
 */
export interface PromiseSlot<T> {
  current: Promise<T> | null;
}

/**
 * Single-flight: while one run is in flight, every concurrent caller shares (awaits) the SAME promise
 * instead of starting its own. The slot is cleared once the run settles, so a later call starts fresh
 * (e.g. a retry after a failed create). This is what makes the create-early `ensureDraft` idempotent
 * under concurrent triggers — N callers issue exactly ONE POST and resolve to the SAME draft id, so
 * `draftCampaignId` can never churn between two duplicate drafts.
 */
export function singleFlight<T>(slot: PromiseSlot<T>, run: () => Promise<T>): Promise<T> {
  if (slot.current) return slot.current;
  const flight = run().finally(() => {
    slot.current = null;
  });
  slot.current = flight;
  return flight;
}

export interface SubmitDeps {
  update: (id: string, input: UpdateCampaignInput) => Promise<CampaignView>;
  submit: (id: string) => Promise<CampaignView>;
}

export interface SaveDraftDeps {
  update: (id: string, input: UpdateCampaignInput) => Promise<CampaignView>;
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

/**
 * Enregistrer (save-draft, NO submit): PATCH the indicative requested_budget onto the draft and stop
 * — the campaign stays a draft the advertiser can resume later. Shares performSubmit's guards (a
 * created draft + a positive budget, both gated by the step validators) so the function is safe to
 * call directly. The API's requested_budget is strictly positive, so a non-positive budget is
 * rejected here rather than round-tripping to a 400.
 */
export async function performSaveDraft(args: {
  state: WizardState;
  deps: SaveDraftDeps;
}): Promise<SaveDraftResult> {
  const { state, deps } = args;
  if (!state.draftCampaignId) {
    return { kind: 'error', error: new Error('La campagne n’a pas encore été créée') };
  }
  if (state.requestedBudget == null || state.requestedBudget <= 0) {
    return { kind: 'error', error: new Error('Le budget doit être supérieur à 0 dinar') };
  }
  try {
    const campaign = await deps.update(state.draftCampaignId, {
      requested_budget: state.requestedBudget,
    });
    return { kind: 'success', campaign };
  } catch (e) {
    return { kind: 'error', error: e instanceof Error ? e : new Error(String(e)) };
  }
}
