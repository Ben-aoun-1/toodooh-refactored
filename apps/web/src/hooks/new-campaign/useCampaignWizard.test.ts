import { describe, expect, it, vi } from 'vitest';

import type { CampaignLocation } from '../../services/campaign-screens.service';

import { performAddToCart, performSaveDraft, serializeForDraft } from './wizard-serialize';
import {
  canStepBeReached,
  getStepList,
  validateBudget,
  validateCategoryOrParc,
  validateNameType,
  validatePeriod,
  validateSpot,
  validateZones,
} from './wizard-steps';
import type { GeographicZone, WizardState } from './wizard-types';

function makeLocation(id: string): CampaignLocation {
  // Casting through `unknown` is the project's standard pattern for fabricating
  // test fixtures against types whose source is still Phase-1-untyped (see #15);
  // CampaignLocation has many supabase-derived fields we don't need to populate.
  return { id, screen_count: 1 } as unknown as CampaignLocation;
}

function makeZone(id: string, locations: CampaignLocation[] = []): GeographicZone {
  return {
    id,
    name: id,
    location: { lat: 36.8, lng: 10.18 },
    radius: 1000,
    locations,
  };
}

function blankState(overrides: Partial<WizardState> = {}): WizardState {
  return {
    campaignType: 'standard',
    campaignName: '',
    client: '',
    categories: [],
    diffusionType: 'toodooh',
    selectedParcIds: [],
    startDate: null,
    endDate: null,
    geographicZones: [],
    adjustedBudget: 0,
    calculatedImpressions: 0,
    customMinBudget: null,
    customMaxBudget: null,
    uploadedVideoId: '',
    uploadedVideoUrl: '',
    existingVideoId: null,
    draftCampaignId: '',
    ...overrides,
  };
}

function validFullState(overrides: Partial<WizardState> = {}): WizardState {
  return blankState({
    campaignName: 'Demo campaign',
    categories: ['Publicité commerciale'],
    diffusionType: 'toodooh',
    startDate: '2026-06-01',
    endDate: '2026-06-15',
    geographicZones: [makeZone('z1', [makeLocation('loc-1')])],
    adjustedBudget: 500,
    calculatedImpressions: 100_000,
    uploadedVideoId: 'vid-1',
    ...overrides,
  });
}

describe('getStepList', () => {
  it('returns 6 standard steps in order', () => {
    const steps = getStepList('standard');
    expect(steps.map((s) => s.id)).toEqual([
      'name-type',
      'category',
      'period',
      'zones',
      'spot',
      'validation',
    ]);
    expect(steps.map((s) => s.index)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('returns 3 event steps in order', () => {
    const steps = getStepList('event');
    expect(steps.map((s) => s.id)).toEqual(['zones', 'spot', 'validation']);
    expect(steps.map((s) => s.index)).toEqual([1, 2, 3]);
  });
});

describe('validators', () => {
  it('validateNameType requires name and diffusionType', () => {
    expect(validateNameType(blankState({ campaignName: '   ' }))).toBe(false);
    expect(validateNameType(blankState({ campaignName: 'X' }))).toBe(true);
  });

  it('validateCategoryOrParc (parc_tv) needs ≥1 parc and ignores categories', () => {
    expect(validateCategoryOrParc(blankState({ diffusionType: 'parc_tv' }), false)).toBe(false);
    expect(
      validateCategoryOrParc(
        blankState({ diffusionType: 'parc_tv', selectedParcIds: ['p1'] }),
        false,
      ),
    ).toBe(true);
  });

  it('validateCategoryOrParc (toodooh + clientRequired) needs categories and client', () => {
    const base = blankState({ categories: ['Publicité commerciale'] });
    expect(validateCategoryOrParc(base, true)).toBe(false);
    expect(validateCategoryOrParc({ ...base, client: 'ACME' }, true)).toBe(true);
    expect(validateCategoryOrParc(base, false)).toBe(true);
  });

  it('validatePeriod requires both dates with start < end', () => {
    expect(validatePeriod(blankState({ startDate: '2026-06-01' }))).toBe(false);
    expect(validatePeriod(blankState({ startDate: '2026-06-15', endDate: '2026-06-01' }))).toBe(
      false,
    );
    expect(validatePeriod(blankState({ startDate: '2026-06-01', endDate: '2026-06-15' }))).toBe(
      true,
    );
  });

  it('validateZones requires ≥1 zone with ≥1 location', () => {
    expect(validateZones(blankState({ geographicZones: [makeZone('z1', [])] }))).toBe(false);
    expect(
      validateZones(blankState({ geographicZones: [makeZone('z1', [makeLocation('loc-1')])] })),
    ).toBe(true);
  });

  it('validateSpot accepts any of the three video signals', () => {
    expect(validateSpot(blankState())).toBe(false);
    expect(validateSpot(blankState({ uploadedVideoId: 'v' }))).toBe(true);
    expect(validateSpot(blankState({ uploadedVideoUrl: 'https://x' }))).toBe(true);
    expect(validateSpot(blankState({ existingVideoId: 'v' }))).toBe(true);
  });

  it('validateBudget requires positive budget and impressions', () => {
    expect(validateBudget(blankState({ adjustedBudget: 0, calculatedImpressions: 1 }))).toBe(false);
    expect(validateBudget(blankState({ adjustedBudget: 1, calculatedImpressions: 0 }))).toBe(false);
    expect(validateBudget(blankState({ adjustedBudget: 1, calculatedImpressions: 1 }))).toBe(true);
  });
});

describe('canStepBeReached', () => {
  it('blocks step N when a prior gate fails', () => {
    const stepList = getStepList('standard');
    const state = blankState({ campaignName: 'X' }); // step 1 passes, step 2 fails (no categories)
    expect(canStepBeReached(state, 1, stepList)).toBe(true);
    expect(canStepBeReached(state, 2, stepList)).toBe(true);
    expect(canStepBeReached(state, 3, stepList)).toBe(false);
  });

  it('returns true for the last step when all prior gates pass', () => {
    const stepList = getStepList('standard');
    expect(canStepBeReached(validFullState(), 6, stepList)).toBe(true);
  });

  it('returns false for out-of-range indices', () => {
    const stepList = getStepList('standard');
    expect(canStepBeReached(validFullState(), 0, stepList)).toBe(false);
    expect(canStepBeReached(validFullState(), 7, stepList)).toBe(false);
  });
});

describe('serializeForDraft', () => {
  const opts = {
    campaignType: 'standard' as const,
    cpmTnd: 5,
    eventId: null,
    fallbackLocation: { lat: 36.8, lng: 10.18 },
  };

  it('maps FR category names to enum values and omits custom budget bounds', () => {
    const state = validFullState({
      categories: ['Publicité commerciale', 'Événement culturel'],
      customMinBudget: 100,
      customMaxBudget: 900,
    });
    const payload = serializeForDraft(state, opts);
    expect(payload.categories).toEqual(['commercial', 'cultural']);
    expect(payload.category).toBe('commercial');
    // No custom budget bounds escape into the persisted shape.
    expect(payload).not.toHaveProperty('customMinBudget');
    expect(payload).not.toHaveProperty('customMaxBudget');
    expect(payload.location_ids).toEqual(['loc-1']);
    expect(payload.location_lat).toBeCloseTo(36.8);
    expect(payload.location_radius).toBe(1000);
    expect(payload.status).toBe('draft');
  });

  it('uses "parc" category and skips location_ids for parc_tv flow with no zones', () => {
    const state = validFullState({
      diffusionType: 'parc_tv',
      categories: [],
      geographicZones: [],
      selectedParcIds: ['p1'],
    });
    const payload = serializeForDraft(state, opts);
    expect(payload.category).toBe('parc');
    expect(payload.categories).toEqual(['parc']);
    expect(payload.location_ids).toBeUndefined();
  });
});

describe('performSaveDraft', () => {
  const serializeOpts = {
    campaignType: 'standard' as const,
    cpmTnd: 5,
    eventId: null,
    fallbackLocation: { lat: 36.8, lng: 10.18 },
  };

  it('returns success with the service id on success', async () => {
    const saveCampaignDraft = vi.fn().mockResolvedValue({ id: 'cmp-42' });
    const result = await performSaveDraft({
      state: validFullState(),
      options: serializeOpts,
      deps: { saveCampaignDraft },
    });
    expect(result).toEqual({ kind: 'success', id: 'cmp-42' });
    expect(saveCampaignDraft).toHaveBeenCalledTimes(1);
  });

  it('returns error when the service throws', async () => {
    const saveCampaignDraft = vi.fn().mockRejectedValue(new Error('boom'));
    const result = await performSaveDraft({
      state: validFullState(),
      options: serializeOpts,
      deps: { saveCampaignDraft },
    });
    expect(result.kind).toBe('error');
    if (result.kind === 'error') expect(result.error.message).toBe('boom');
  });

  it('returns error without calling the service when name is missing', async () => {
    const saveCampaignDraft = vi.fn();
    const result = await performSaveDraft({
      state: validFullState({ campaignName: '   ' }),
      options: serializeOpts,
      deps: { saveCampaignDraft },
    });
    expect(result.kind).toBe('error');
    expect(saveCampaignDraft).not.toHaveBeenCalled();
  });
});

describe('performAddToCart', () => {
  const options = {
    campaignType: 'standard' as const,
    cpmTnd: 5,
    eventId: null,
    fallbackLocation: { lat: 36.8, lng: 10.18 },
    eventName: null,
  };

  function makeDeps() {
    return {
      saveCampaignDraft: vi.fn().mockResolvedValue({ id: 'cmp-99' }),
      checkCampaignBalance: vi.fn().mockResolvedValue({ has_sufficient_balance: true }),
      revertToDraft: vi.fn().mockResolvedValue({ error: null }),
      addCartItem: vi.fn(),
    };
  }

  it('returns success and pushes a cart item on the happy path', async () => {
    const deps = makeDeps();
    const result = await performAddToCart({ state: validFullState(), options, deps });
    expect(result).toEqual({ kind: 'success', campaignId: 'cmp-99' });
    expect(deps.addCartItem).toHaveBeenCalledTimes(1);
    expect(deps.addCartItem.mock.calls[0]?.[0]).toMatchObject({
      id: 'cmp-99',
      name: 'Demo campaign',
      amount: 500,
    });
    expect(deps.revertToDraft).not.toHaveBeenCalled();
  });

  it('returns insufficient_balance and reverts when the balance check fails', async () => {
    const deps = makeDeps();
    deps.checkCampaignBalance.mockResolvedValueOnce({ has_sufficient_balance: false });
    const result = await performAddToCart({ state: validFullState(), options, deps });
    expect(result).toEqual({ kind: 'insufficient_balance' });
    expect(deps.revertToDraft).toHaveBeenCalledWith('cmp-99');
    expect(deps.addCartItem).not.toHaveBeenCalled();
  });

  it('returns error when the balance service throws', async () => {
    const deps = makeDeps();
    deps.checkCampaignBalance.mockRejectedValueOnce(new Error('balance offline'));
    const result = await performAddToCart({ state: validFullState(), options, deps });
    expect(result.kind).toBe('error');
    if (result.kind === 'error') expect(result.error.message).toBe('balance offline');
    expect(deps.addCartItem).not.toHaveBeenCalled();
  });

  it('reuses the existing draft id without calling saveCampaignDraft again', async () => {
    const deps = makeDeps();
    const result = await performAddToCart({
      state: validFullState({ draftCampaignId: 'cmp-existing' }),
      options,
      deps,
    });
    expect(result).toEqual({ kind: 'success', campaignId: 'cmp-existing' });
    expect(deps.saveCampaignDraft).not.toHaveBeenCalled();
    expect(deps.checkCampaignBalance).toHaveBeenCalledWith('cmp-existing');
  });
});
