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
  // CF-W1 — dates moved to the Période step (3): the create-early draft is legitimately
  // date-less (the API accepts nullable dates; they PATCH later via saveDraft/submit).
  if (state.startDate && state.endDate && state.startDate >= state.endDate) {
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
 * The full draft PATCH body (CF-W1): dates now arrive at the Période step (after create-early),
 * so save/submit persist the WHOLE editable state, not just the budget. An emptied name is
 * omitted (the API's name is min-1; the draft keeps its stored name). CF-U1 (Mejri item 6): an
 * UNTOUCHED budget (state null) is OMITTED — the draft keeps its NULL and never inherits the
 * slider default; an explicitly set value (any re-drag) persists as before.
 */
function draftPatch(state: WizardState): UpdateCampaignInput {
  return {
    ...(state.campaignName.trim() ? { name: state.campaignName.trim() } : {}),
    start_date: state.startDate,
    end_date: state.endDate,
    ...(state.requestedBudget != null ? { requested_budget: state.requestedBudget } : {}),
    // CF-Z1 — replace-set: [] legitimately clears (whole network on the zone criterion).
    zone_ids: state.zoneIds,
  };
}

/**
 * Interim cart submit: PATCH the draft state (name/dates/indicative budget), then POST /:id/submit
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
    await deps.update(state.draftCampaignId, draftPatch(state));
    const campaign = await deps.submit(state.draftCampaignId);
    return { kind: 'success', campaign };
  } catch (e) {
    return { kind: 'error', error: e instanceof Error ? e : new Error(String(e)) };
  }
}

/**
 * Enregistrer (save-draft, NO submit): PATCH the draft state and stop — the campaign stays a
 * draft the advertiser can resume later. CF-U1 (Mejri item 6): a NULL budget is a LEGITIMATE
 * draft state (per-step Enregistrer runs long before Validation), so only an explicitly set
 * non-positive value is rejected (the API's requested_budget is strictly positive — fail here
 * rather than round-tripping to a 400). The positive-budget requirement lives at SUBMIT.
 */
export async function performSaveDraft(args: {
  state: WizardState;
  deps: SaveDraftDeps;
}): Promise<SaveDraftResult> {
  const { state, deps } = args;
  if (!state.draftCampaignId) {
    return { kind: 'error', error: new Error('La campagne n’a pas encore été créée') };
  }
  if (state.requestedBudget != null && state.requestedBudget <= 0) {
    return { kind: 'error', error: new Error('Le budget doit être supérieur à 0 dinar') };
  }
  try {
    const campaign = await deps.update(state.draftCampaignId, draftPatch(state));
    return { kind: 'success', campaign };
  } catch (e) {
    return { kind: 'error', error: e instanceof Error ? e : new Error(String(e)) };
  }
}
