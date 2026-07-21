import { describe, expect, it, vi } from 'vitest';

import type { CampaignView } from '@/features/campaigns/services/campaigns.api';

import {
  performCreateDraft,
  performSaveDraft,
  performAddToCart,
  serializeCreate,
  singleFlight,
} from './wizard-serialize';
import {
  canStepBeReached,
  getStepList,
  validateBasics,
  validateDates,
  validateCart,
  validateZones,
  validateCreative,
  validateTargeting,
} from './wizard-steps';
import type { WizardState } from './wizard-types';

function blankState(overrides: Partial<WizardState> = {}): WizardState {
  return {
    campaignName: '',
    startDate: null,
    endDate: null,
    creativeId: null,
    requestedBudget: null,
    zoneIds: [],
    draftCampaignId: '',
    ...overrides,
  };
}

function validBasics(overrides: Partial<WizardState> = {}): WizardState {
  return blankState({
    campaignName: 'Demo campaign',
    startDate: '2026-07-01',
    endDate: '2026-07-15',
    ...overrides,
  });
}

function fakeCampaign(overrides: Partial<CampaignView> = {}): CampaignView {
  return {
    id: 'cmp-1',
    name: 'Demo campaign',
    campaign_type: 'standard',
    status: 'draft',
    start_date: '2026-07-01',
    end_date: '2026-07-15',
    rejected_at: null,
    reject_reason: null,
    creative_id: null,
    description: null,
    requested_budget: null,
    content_validation_status: null,
    submitted_at: null,
    created_at: '2026-06-28T00:00:00.000Z',
    updated_at: '2026-06-28T00:00:00.000Z',
    ...overrides,
  };
}

describe('getStepList', () => {
  it('returns the 6 CF-W1 steps in order (name+type, categories, dates, coverage, creative, cart)', () => {
    const steps = getStepList();
    expect(steps.map((s) => s.id)).toEqual([
      'basics',
      'targeting',
      'dates',
      'zones',
      'creative',
      'cart',
    ]);
    expect(steps.map((s) => s.index)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(steps.map((s) => s.label)).toEqual([
      'Nom et type',
      'Catégories',
      'Période',
      'Zones géographiques',
      'Création',
      'Validation',
    ]);
  });
});

describe('validators', () => {
  it('validateBasics requires a NAME only (dates moved to the Période step; type chips are UI-only)', () => {
    expect(validateBasics(blankState({ campaignName: '   ' }))).toBe(false);
    expect(validateBasics(blankState({ campaignName: 'Demo' }))).toBe(true);
    expect(validateBasics(validBasics({ startDate: null, endDate: null }))).toBe(true);
  });

  it('validateDates requires a start < end range', () => {
    expect(validateDates(validBasics({ endDate: null }))).toBe(false);
    expect(validateDates(validBasics({ startDate: '2026-07-15', endDate: '2026-07-01' }))).toBe(
      false,
    );
    expect(validateDates(validBasics())).toBe(true);
  });

  it('validateTargeting is always satisfiable (optional, panel-persisted)', () => {
    expect(validateTargeting(blankState())).toBe(true);
  });

  it('validateZones is always satisfiable (optional — no zones = whole network)', () => {
    expect(validateZones(blankState())).toBe(true);
  });

  it('validateCreative requires a linked creative id', () => {
    expect(validateCreative(blankState())).toBe(false);
    expect(validateCreative(blankState({ creativeId: 'crv-1' }))).toBe(true);
  });

  it('validateCart requires the 100 TND floor (CF-U3 — mirrors the submit gate)', () => {
    expect(validateCart(blankState({ requestedBudget: 0 }))).toBe(false);
    expect(validateCart(blankState({ requestedBudget: -5 }))).toBe(false);
    expect(validateCart(blankState({ requestedBudget: 99 }))).toBe(false);
    expect(validateCart(blankState({ requestedBudget: 100 }))).toBe(true);
    expect(validateCart(blankState({ requestedBudget: 500 }))).toBe(true);
  });
});

describe('canStepBeReached', () => {
  it('blocks a step when a prior gate fails', () => {
    const stepList = getStepList();
    // Name + dates valid → up to creative (5) reachable; cart (6) blocked (no creative).
    const state = validBasics();
    expect(canStepBeReached(state, 1, stepList)).toBe(true);
    expect(canStepBeReached(state, 2, stepList)).toBe(true);
    expect(canStepBeReached(state, 3, stepList)).toBe(true);
    expect(canStepBeReached(state, 4, stepList)).toBe(true);
    expect(canStepBeReached(state, 5, stepList)).toBe(true);
    expect(canStepBeReached(state, 6, stepList)).toBe(false); // creative gate fails → cart blocked
  });

  it('a date-less draft stops at the Période gate (coverage/4 unreachable)', () => {
    const stepList = getStepList();
    const state = blankState({ campaignName: 'Demo' });
    expect(canStepBeReached(state, 3, stepList)).toBe(true); // dates step itself opens
    expect(canStepBeReached(state, 4, stepList)).toBe(false); // its gate fails past it
  });

  it('reaches the last step when every prior gate passes', () => {
    const stepList = getStepList();
    const state = validBasics({ creativeId: 'crv-1' });
    expect(canStepBeReached(state, 6, stepList)).toBe(true);
  });

  it('returns false for out-of-range indices', () => {
    const stepList = getStepList();
    expect(canStepBeReached(validBasics(), 0, stepList)).toBe(false);
    expect(canStepBeReached(validBasics(), 7, stepList)).toBe(false);
  });
});

describe('serializeCreate', () => {
  it('builds the standard create-early payload and trims the name', () => {
    const payload = serializeCreate(validBasics({ campaignName: '  Demo  ' }));
    expect(payload).toEqual({
      name: 'Demo',
      campaign_type: 'standard',
      start_date: '2026-07-01',
      end_date: '2026-07-15',
    });
  });
});

describe('performCreateDraft', () => {
  it('returns the created id on success', async () => {
    const create = vi.fn().mockResolvedValue(fakeCampaign({ id: 'cmp-42' }));
    const result = await performCreateDraft({ state: validBasics(), deps: { create } });
    expect(result).toEqual({ kind: 'success', id: 'cmp-42' });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('rejects without calling the API when the date range is invalid', async () => {
    const create = vi.fn();
    const result = await performCreateDraft({
      state: validBasics({ startDate: '2026-07-15', endDate: '2026-07-01' }),
      deps: { create },
    });
    expect(result.kind).toBe('error');
    expect(create).not.toHaveBeenCalled();
  });

  it('CF-W1: creates a DATE-LESS draft (dates arrive at the Période step)', async () => {
    const create = vi.fn().mockResolvedValue(fakeCampaign({ id: 'cmp-43' }));
    const result = await performCreateDraft({
      state: blankState({ campaignName: 'Demo' }),
      deps: { create },
    });
    expect(result).toEqual({ kind: 'success', id: 'cmp-43' });
    expect(create).toHaveBeenCalledWith({
      name: 'Demo',
      campaign_type: 'standard',
      start_date: null,
      end_date: null,
    });
  });

  it('surfaces an API error', async () => {
    const create = vi.fn().mockRejectedValue(new Error('boom'));
    const result = await performCreateDraft({ state: validBasics(), deps: { create } });
    expect(result.kind).toBe('error');
    if (result.kind === 'error') expect(result.error.message).toBe('boom');
  });
});

describe('performAddToCart (CF-C1 — « Ajouter au panier », the submit path retired)', () => {
  function makeDeps() {
    return {
      update: vi.fn().mockResolvedValue(fakeCampaign()),
      addToCart: vi.fn().mockResolvedValue({ campaign_id: 'cmp-9' }),
    };
  }

  it('PATCHes the FULL draft (name/dates/budget — CF-W1) then adds to the cart', async () => {
    const deps = makeDeps();
    const state = validBasics({
      draftCampaignId: 'cmp-9',
      creativeId: 'crv-1',
      requestedBudget: 750,
    });
    const result = await performAddToCart({ state, deps });
    expect(result.kind).toBe('success');
    if (result.kind === 'success') expect(result.campaignId).toBe('cmp-9');
    expect(deps.update).toHaveBeenCalledWith('cmp-9', {
      name: state.campaignName.trim(),
      start_date: state.startDate,
      end_date: state.endDate,
      requested_budget: 750,
      zone_ids: state.zoneIds,
    });
    expect(deps.addToCart).toHaveBeenCalledWith('cmp-9');
  });

  it('errors without calling the API when there is no draft id', async () => {
    const deps = makeDeps();
    const result = await performAddToCart({
      state: validBasics({ requestedBudget: 750 }),
      deps,
    });
    expect(result.kind).toBe('error');
    expect(deps.update).not.toHaveBeenCalled();
    expect(deps.addToCart).not.toHaveBeenCalled();
  });

  it('errors without calling the API when the budget is not positive', async () => {
    const deps = makeDeps();
    const result = await performAddToCart({
      state: validBasics({ draftCampaignId: 'cmp-9', requestedBudget: 0 }),
      deps,
    });
    expect(result.kind).toBe('error');
    expect(deps.update).not.toHaveBeenCalled();
  });

  it('surfaces an API error from the cart add (the precise gate code rides the error)', async () => {
    const deps = makeDeps();
    deps.addToCart.mockRejectedValueOnce(new Error('BUDGET_EXCEEDS_CMAX'));
    const state = validBasics({ draftCampaignId: 'cmp-9', requestedBudget: 750 });
    const result = await performAddToCart({ state, deps });
    expect(result.kind).toBe('error');
    if (result.kind === 'error') expect(result.error.message).toBe('BUDGET_EXCEEDS_CMAX');
  });
});

describe('performSaveDraft (Enregistrer — save without submit)', () => {
  it('PATCHes the FULL draft (name/dates/budget — CF-W1) and does NOT submit', async () => {
    const update = vi.fn().mockResolvedValue(fakeCampaign({ requested_budget: 750 }));
    const state = validBasics({
      draftCampaignId: 'cmp-9',
      creativeId: 'crv-1',
      requestedBudget: 750,
    });
    const result = await performSaveDraft({ state, deps: { update } });
    expect(result.kind).toBe('success');
    if (result.kind === 'success') expect(result.campaign.status).toBe('draft');
    expect(update).toHaveBeenCalledWith('cmp-9', {
      name: state.campaignName.trim(),
      start_date: state.startDate,
      end_date: state.endDate,
      requested_budget: 750,
      zone_ids: state.zoneIds,
    });
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('omits an EMPTIED name from the PATCH (the draft keeps its stored name)', async () => {
    const update = vi.fn().mockResolvedValue(fakeCampaign());
    const state = validBasics({
      draftCampaignId: 'cmp-9',
      campaignName: '   ',
      requestedBudget: 500,
    });
    await performSaveDraft({ state, deps: { update } });
    expect(update).toHaveBeenCalledWith('cmp-9', {
      start_date: state.startDate,
      end_date: state.endDate,
      requested_budget: 500,
      zone_ids: state.zoneIds,
    });
  });

  it('errors without calling the API when there is no draft id', async () => {
    const update = vi.fn();
    const result = await performSaveDraft({
      state: validBasics({ requestedBudget: 750 }),
      deps: { update },
    });
    expect(result.kind).toBe('error');
    expect(update).not.toHaveBeenCalled();
  });

  it('errors without calling the API when the budget is not positive', async () => {
    const update = vi.fn();
    const result = await performSaveDraft({
      state: validBasics({ draftCampaignId: 'cmp-9', requestedBudget: 0 }),
      deps: { update },
    });
    expect(result.kind).toBe('error');
    expect(update).not.toHaveBeenCalled();
  });

  it('surfaces an API error from update', async () => {
    const update = vi.fn().mockRejectedValue(new Error('save failed'));
    const state = validBasics({ draftCampaignId: 'cmp-9', requestedBudget: 750 });
    const result = await performSaveDraft({ state, deps: { update } });
    expect(result.kind).toBe('error');
    if (result.kind === 'error') expect(result.error.message).toBe('save failed');
  });
});

describe('singleFlight (ensureDraft concurrency guard)', () => {
  it('shares ONE in-flight run across concurrent callers and resolves both to the same value', async () => {
    const slot: { current: Promise<string> | null } = { current: null };
    let resolveRun: (v: string) => void = () => undefined;
    const run = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveRun = resolve;
        }),
    );

    // Two concurrent invocations while the first is still in flight (the prod race: "Suivant" + a
    // breadcrumb click). Only ONE underlying run (= ONE POST /api/campaigns) must fire.
    const a = singleFlight(slot, run);
    const b = singleFlight(slot, run);
    expect(run).toHaveBeenCalledTimes(1);

    resolveRun('cmp-shared');
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra).toBe('cmp-shared');
    expect(rb).toBe('cmp-shared'); // both callers see the SAME draft id — no churn
    expect(slot.current).toBeNull(); // slot cleared once settled
  });

  it('starts a fresh run after the previous one has settled (allows retry)', async () => {
    const slot: { current: Promise<string> | null } = { current: null };
    const run = vi.fn().mockResolvedValue('cmp-1');

    await singleFlight(slot, run);
    await singleFlight(slot, run);

    expect(run).toHaveBeenCalledTimes(2);
  });

  it('clears the slot even when the run rejects (so a retry can proceed)', async () => {
    const slot: { current: Promise<string> | null } = { current: null };
    const run = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce('cmp-2');

    await expect(singleFlight(slot, run)).rejects.toThrow('boom');
    expect(slot.current).toBeNull();
    await expect(singleFlight(slot, run)).resolves.toBe('cmp-2');
    expect(run).toHaveBeenCalledTimes(2);
  });
});

// ── CF-U1 (Mejri item 6) — the budget-null contract, wizard side ───────────────────────────────
describe('budget-null contract (CF-U1)', () => {
  it('performSaveDraft with an UNTOUCHED budget (null) succeeds and OMITS requested_budget', async () => {
    const update = vi.fn().mockResolvedValue(fakeCampaign({ requested_budget: null }));
    const state = validBasics({ draftCampaignId: 'cmp-9', requestedBudget: null });
    const result = await performSaveDraft({ state, deps: { update } });
    expect(result.kind).toBe('success');
    expect(update).toHaveBeenCalledWith('cmp-9', {
      name: state.campaignName.trim(),
      start_date: state.startDate,
      end_date: state.endDate,
      zone_ids: state.zoneIds,
    });
    const patch = update.mock.calls[0]?.[1] as Record<string, unknown>;
    expect('requested_budget' in patch).toBe(false); // the draft keeps its NULL — no phantom 5 000
  });

  it('an explicitly set budget still rides the PATCH (any re-drag persists)', async () => {
    const update = vi.fn().mockResolvedValue(fakeCampaign({ requested_budget: 50 }));
    const state = validBasics({ draftCampaignId: 'cmp-9', requestedBudget: 50 });
    await performSaveDraft({ state, deps: { update } });
    expect(update.mock.calls[0]?.[1]).toMatchObject({ requested_budget: 50 });
  });

  it('performAddToCart still refuses a NULL budget without calling the API (the cart gate)', async () => {
    const deps = {
      update: vi.fn().mockResolvedValue(fakeCampaign()),
      addToCart: vi.fn().mockResolvedValue({ campaign_id: 'cmp-9' }),
    };
    const result = await performAddToCart({
      state: validBasics({ draftCampaignId: 'cmp-9', requestedBudget: null }),
      deps,
    });
    expect(result.kind).toBe('error');
    expect(deps.update).not.toHaveBeenCalled();
    expect(deps.addToCart).not.toHaveBeenCalled();
  });
});
