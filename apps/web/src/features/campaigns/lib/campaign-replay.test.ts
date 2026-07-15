import { describe, expect, it, vi } from 'vitest';

// The service module builds on apiClient — stubbed: only the pure replay chain is under test.
vi.mock('@/lib/api-client', () => ({ apiClient: {} }));

import { getStepList } from '@/features/campaigns/hooks/new-campaign/wizard-steps';
import type { CampaignView } from '@/features/campaigns/services/campaigns.api';

import {
  REPLAY_ERROR_TOAST,
  REPLAY_SUCCESS_TOAST,
  canReplayCampaign,
  performReplay,
  replayLandingStep,
} from './campaign-replay';

// CF-RJ1 (spec §3.3) — « Rejouer » gating, the Période landing step and the
// replay→store→navigate chain, pinned at helper level (no render harness).

const clone = (overrides: Partial<CampaignView> = {}): CampaignView => ({
  id: 'clone-id',
  name: 'Été 2025',
  campaign_type: 'standard',
  status: 'draft',
  start_date: null,
  end_date: null,
  description: null,
  requested_budget: 1500,
  content_validation_status: 'approved',
  submitted_at: null,
  rejected_at: null,
  reject_reason: null,
  creative_id: 'creative-1',
  created_at: '2026-07-15T00:00:00.000Z',
  updated_at: '2026-07-15T00:00:00.000Z',
  zones: [{ zone_id: 'z1', name: 'Grand Tunis' }],
  ...overrides,
});

describe('canReplayCampaign (Rejouer is a Passée-only affordance)', () => {
  it('allows exactly completed', () => {
    expect(canReplayCampaign('completed')).toBe(true);
    for (const status of ['draft', 'pending', 'upcoming', 'active', 'rejected']) {
      expect(canReplayCampaign(status)).toBe(false);
    }
  });
});

describe('replayLandingStep (the clone lands on Période)', () => {
  it('resolves Période from the real step list — step 3', () => {
    expect(replayLandingStep()).toBe(3);
    expect(getStepList().find((s) => s.index === replayLandingStep())?.label).toBe('Période');
  });
});

describe('performReplay (the replay→store→navigate chain)', () => {
  it('success: POST → store keyed to the NEW draft id at Période → wizard navigation', async () => {
    const created = clone();
    const calls: string[] = [];
    const replay = vi.fn(async (id: string) => {
      calls.push(`replay:${id}`);
      return created;
    });
    const setResumeStep = vi.fn((draftId: string, step: number) => {
      calls.push(`store:${draftId}:${step}`);
    });
    const navigate = vi.fn(() => {
      calls.push('navigate');
    });

    const result = await performReplay({
      sourceId: 'source-id',
      deps: { replay, setResumeStep, navigate },
    });

    expect(result).toEqual({ kind: 'success', campaign: created });
    expect(replay).toHaveBeenCalledWith('source-id');
    // Store key hygiene: keyed to the CLONE id (never the source), at the Période index.
    expect(setResumeStep).toHaveBeenCalledExactlyOnceWith('clone-id', 3);
    expect(navigate).toHaveBeenCalledExactlyOnceWith('/new-campaign', {
      state: { editMode: true, campaign: created },
    });
    // The store write lands BEFORE navigation — the wizard reads it at mount.
    expect(calls).toEqual(['replay:source-id', 'store:clone-id:3', 'navigate']);
  });

  it('failure: no store write, no navigation — the caller toasts the error', async () => {
    const replay = vi.fn(async () => {
      throw new Error('boom');
    });
    const setResumeStep = vi.fn();
    const navigate = vi.fn();

    const result = await performReplay({
      sourceId: 'source-id',
      deps: { replay, setResumeStep, navigate },
    });

    expect(result.kind).toBe('error');
    expect(setResumeStep).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe('Rejouer copy (pinned)', () => {
  it('success + failure toasts', () => {
    expect(REPLAY_SUCCESS_TOAST).toBe('Campagne dupliquée — choisissez la nouvelle période.');
    expect(REPLAY_ERROR_TOAST).toBe('Impossible de dupliquer la campagne');
  });
});
