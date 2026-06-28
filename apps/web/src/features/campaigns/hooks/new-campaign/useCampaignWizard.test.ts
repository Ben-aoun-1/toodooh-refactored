import { describe, expect, it, vi } from 'vitest';

import type { CampaignView } from '@/features/campaigns/services/campaigns.api';

import {
  performCreateDraft,
  performSubmit,
  serializeCreate,
  singleFlight,
} from './wizard-serialize';
import {
  canStepBeReached,
  getStepList,
  validateBasics,
  validateCart,
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
  it('returns the 4 REST-engine steps in order', () => {
    const steps = getStepList();
    expect(steps.map((s) => s.id)).toEqual(['basics', 'targeting', 'creative', 'cart']);
    expect(steps.map((s) => s.index)).toEqual([1, 2, 3, 4]);
  });
});

describe('validators', () => {
  it('validateBasics requires a name and a start < end range', () => {
    expect(validateBasics(blankState({ campaignName: '   ' }))).toBe(false);
    expect(validateBasics(validBasics({ endDate: null }))).toBe(false);
    expect(validateBasics(validBasics({ startDate: '2026-07-15', endDate: '2026-07-01' }))).toBe(
      false,
    );
    expect(validateBasics(validBasics())).toBe(true);
  });

  it('validateTargeting is always satisfiable (optional, panel-persisted)', () => {
    expect(validateTargeting(blankState())).toBe(true);
  });

  it('validateCreative requires a linked creative id', () => {
    expect(validateCreative(blankState())).toBe(false);
    expect(validateCreative(blankState({ creativeId: 'crv-1' }))).toBe(true);
  });

  it('validateCart requires a positive budget', () => {
    expect(validateCart(blankState({ requestedBudget: 0 }))).toBe(false);
    expect(validateCart(blankState({ requestedBudget: -5 }))).toBe(false);
    expect(validateCart(blankState({ requestedBudget: 500 }))).toBe(true);
  });
});

describe('canStepBeReached', () => {
  it('blocks a step when a prior gate fails', () => {
    const stepList = getStepList();
    // Basics valid → targeting (always-true) reachable; creative blocked (no creative).
    const state = validBasics();
    expect(canStepBeReached(state, 1, stepList)).toBe(true);
    expect(canStepBeReached(state, 2, stepList)).toBe(true);
    expect(canStepBeReached(state, 3, stepList)).toBe(true); // targeting gate is always true
    expect(canStepBeReached(state, 4, stepList)).toBe(false); // creative gate fails
  });

  it('reaches the last step when every prior gate passes', () => {
    const stepList = getStepList();
    const state = validBasics({ creativeId: 'crv-1' });
    expect(canStepBeReached(state, 4, stepList)).toBe(true);
  });

  it('returns false for out-of-range indices', () => {
    const stepList = getStepList();
    expect(canStepBeReached(validBasics(), 0, stepList)).toBe(false);
    expect(canStepBeReached(validBasics(), 5, stepList)).toBe(false);
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

  it('surfaces an API error', async () => {
    const create = vi.fn().mockRejectedValue(new Error('boom'));
    const result = await performCreateDraft({ state: validBasics(), deps: { create } });
    expect(result.kind).toBe('error');
    if (result.kind === 'error') expect(result.error.message).toBe('boom');
  });
});

describe('performSubmit', () => {
  function makeDeps() {
    return {
      update: vi.fn().mockResolvedValue(fakeCampaign()),
      submit: vi.fn().mockResolvedValue(fakeCampaign({ status: 'pending' })),
    };
  }

  it('PATCHes the budget then submits on the happy path', async () => {
    const deps = makeDeps();
    const state = validBasics({
      draftCampaignId: 'cmp-9',
      creativeId: 'crv-1',
      requestedBudget: 750,
    });
    const result = await performSubmit({ state, deps });
    expect(result.kind).toBe('success');
    if (result.kind === 'success') expect(result.campaign.status).toBe('pending');
    expect(deps.update).toHaveBeenCalledWith('cmp-9', { requested_budget: 750 });
    expect(deps.submit).toHaveBeenCalledWith('cmp-9');
  });

  it('errors without calling the API when there is no draft id', async () => {
    const deps = makeDeps();
    const result = await performSubmit({
      state: validBasics({ requestedBudget: 750 }),
      deps,
    });
    expect(result.kind).toBe('error');
    expect(deps.update).not.toHaveBeenCalled();
    expect(deps.submit).not.toHaveBeenCalled();
  });

  it('errors without calling the API when the budget is not positive', async () => {
    const deps = makeDeps();
    const result = await performSubmit({
      state: validBasics({ draftCampaignId: 'cmp-9', requestedBudget: 0 }),
      deps,
    });
    expect(result.kind).toBe('error');
    expect(deps.update).not.toHaveBeenCalled();
  });

  it('surfaces an API error from submit', async () => {
    const deps = makeDeps();
    deps.submit.mockRejectedValueOnce(new Error('submit failed'));
    const state = validBasics({ draftCampaignId: 'cmp-9', requestedBudget: 750 });
    const result = await performSubmit({ state, deps });
    expect(result.kind).toBe('error');
    if (result.kind === 'error') expect(result.error.message).toBe('submit failed');
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
