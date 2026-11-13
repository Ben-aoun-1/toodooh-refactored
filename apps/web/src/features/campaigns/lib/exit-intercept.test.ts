import { describe, expect, it } from 'vitest';

import {
  DRAFT_EXIT_MESSAGE,
  EDITS_EXIT_MESSAGE,
  WIZARD_EXIT_MESSAGE,
  editsADraft,
  quitDeletesDraft,
  shouldArmExitGuard,
} from './exit-intercept';

// CF-W1 §1.9 — the exit-intercept decision matrix (the popup wiring is evidence-driven; the
// decisions are pinned here).

describe('shouldArmExitGuard (popup + beforeunload arming)', () => {
  it('arms a FRESH draft that was never explicitly saved, even with no further edits', () => {
    expect(
      shouldArmExitGuard({ hasDraft: true, explicitlySaved: false, dirtySinceSave: false }),
    ).toBe(true);
  });

  it('arms on unsaved edits — resumed drafts and the not-yet-created name field alike', () => {
    expect(
      shouldArmExitGuard({ hasDraft: true, explicitlySaved: true, dirtySinceSave: true }),
    ).toBe(true);
    expect(
      shouldArmExitGuard({ hasDraft: false, explicitlySaved: false, dirtySinceSave: true }),
    ).toBe(true);
  });

  it('DISARMS once saved and clean (save/submit → no orphan intercept)', () => {
    expect(
      shouldArmExitGuard({ hasDraft: true, explicitlySaved: true, dirtySinceSave: false }),
    ).toBe(false);
  });

  it('stays quiet on a pristine fresh wizard (nothing typed, nothing created)', () => {
    expect(
      shouldArmExitGuard({ hasDraft: false, explicitlySaved: false, dirtySinceSave: false }),
    ).toBe(false);
  });
});

describe('quitDeletesDraft (DISP-TOURS §3.1 — a draft is saved or deleted for good)', () => {
  it('a draft made in this wizard is deleted', () => {
    expect(quitDeletesDraft({ hasDraft: true, editingStatus: null })).toBe(true);
  });

  it('a resumed draft is deleted too (« Supprimer définitivement »)', () => {
    expect(quitDeletesDraft({ hasDraft: true, editingStatus: 'draft' })).toBe(true);
  });

  it('a refused campaign being corrected is never deleted (its unsaved edits are dropped)', () => {
    expect(quitDeletesDraft({ hasDraft: true, editingStatus: 'rejected' })).toBe(false);
  });

  it('nothing to delete without a draft', () => {
    expect(quitDeletesDraft({ hasDraft: false, editingStatus: null })).toBe(false);
  });

  it('the popup speaks of a draft unless a refused campaign is being corrected', () => {
    expect(editsADraft(null)).toBe(true);
    expect(editsADraft('draft')).toBe(true);
    expect(editsADraft('rejected')).toBe(false);
  });
});

describe('the popup copy', () => {
  it('is the spec message verbatim (the event positionings keep it)', () => {
    expect(WIZARD_EXIT_MESSAGE).toBe(
      'Vous allez perdre définitivement les infos insérées dans cette campagne, êtes-vous sûr de vouloir quitter ?',
    );
  });

  it('offers to keep the draft or to delete it (Mariem §3.1)', () => {
    expect(DRAFT_EXIT_MESSAGE).toBe(
      'Vous quittez la création de cette campagne. Voulez-vous l’enregistrer en brouillon ou la supprimer définitivement ?',
    );
    expect(EDITS_EXIT_MESSAGE).toContain('modifications non enregistrées');
  });
});
