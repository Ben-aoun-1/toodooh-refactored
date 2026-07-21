import { describe, expect, it, vi } from 'vitest';

import { htTtcOrDash } from '@/lib/money';

import { buildInitialWizardState } from './wizard-init';
import { performCreateDraft, performSaveDraft, serializeCreate } from './wizard-serialize';
import type { WizardState } from './wizard-types';

// CF-U3 item 1 (Mejri's « 5 000 » report) — HER EXACT REPRO, pinned permanently: a fresh
// campaign saved as brouillon BEFORE ever reaching Validation must persist NO requested_budget
// (the row stays NULL → Mes campagnes renders « — »). Covers BOTH save affordances at steps
// 1/2/3-shaped states: the header Enregistrer AND the exit-popup Enregistrer are the SAME
// performSaveDraft path (NewCampaign.handleExitSave delegates to handleSaveDraft), so one body
// builder (draftPatch) is the single thing these pins must hold.
//
// The CF-U3 sweep found NO writer of 5 000 on current main (static: every FE path + the API
// create/PATCH are null-safe; empirical: both save paths persisted NULL against a live stack) —
// these pins keep it that way.

const freshState = (over: Partial<WizardState> = {}): WizardState => ({
  ...buildInitialWizardState({ campaignToEdit: null }),
  campaignName: 'Mejri repro',
  ...over,
});

describe('her repro — the create never carries a budget', () => {
  it('serializeCreate has NO requested_budget key at all', () => {
    const body = serializeCreate(freshState());
    expect('requested_budget' in body).toBe(false);
  });

  it('the fresh wizard state starts with a NULL budget (no phantom default)', () => {
    expect(freshState().requestedBudget).toBeNull();
  });

  it('performCreateDraft posts exactly the budget-less body', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'c1' });
    await performCreateDraft({ state: freshState(), deps: { create } });
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]?.[0]).not.toHaveProperty('requested_budget');
  });
});

describe('her repro — Enregistrer at steps 1/2/3 (header AND exit-popup: one shared path)', () => {
  // Step-shaped states: step 1 = name only; step 2 = +targeting done (not in this state);
  // step 3 = +dates. The budget stays untouched (null) in all three.
  const step1 = freshState({ draftCampaignId: 'c1' });
  const step3 = freshState({
    draftCampaignId: 'c1',
    startDate: '2026-08-03',
    endDate: '2026-08-10',
  });

  it.each([
    ['step 1 (name only)', step1],
    ['step 3 (dates set)', step3],
  ])('save at %s PATCHes WITHOUT requested_budget', async (_label, state) => {
    const update = vi.fn().mockResolvedValue({ id: 'c1' });
    const result = await performSaveDraft({ state, deps: { update } });
    expect(result.kind).toBe('success');
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0]?.[1]).not.toHaveProperty('requested_budget');
  });

  it('an explicitly chosen budget still persists (the pin never blocks real values)', async () => {
    const update = vi.fn().mockResolvedValue({ id: 'c1' });
    await performSaveDraft({
      state: freshState({ draftCampaignId: 'c1', requestedBudget: 250 }),
      deps: { update },
    });
    expect(update.mock.calls[0]?.[1]).toMatchObject({ requested_budget: 250 });
  });
});

describe('her repro — what Mes campagnes renders for the untouched draft', () => {
  it('a NULL budget renders « — », never a phantom amount', () => {
    expect(htTtcOrDash(null)).toBe('—');
    expect(htTtcOrDash(undefined)).toBe('—');
  });
});
