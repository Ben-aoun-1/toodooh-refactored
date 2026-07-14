import { describe, expect, it } from 'vitest';

import { WIZARD_EXIT_MESSAGE, quitDeletesDraft, shouldArmExitGuard } from './exit-intercept';

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

describe('quitDeletesDraft (the RULED fresh-vs-resumed distinction)', () => {
  it('FRESH quit deletes: a create-early draft never explicitly saved leaves NOTHING behind', () => {
    expect(quitDeletesDraft({ hasDraft: true, explicitlySaved: false })).toBe(true);
  });

  it('RESUMED quit keeps the draft (only the unsaved edits are discarded)', () => {
    expect(quitDeletesDraft({ hasDraft: true, explicitlySaved: true })).toBe(false);
  });

  it('nothing to delete without a draft', () => {
    expect(quitDeletesDraft({ hasDraft: false, explicitlySaved: false })).toBe(false);
  });
});

describe('the popup copy', () => {
  it('is the spec message verbatim', () => {
    expect(WIZARD_EXIT_MESSAGE).toBe(
      'Vous allez perdre définitivement les infos insérées dans cette campagne, êtes-vous sûr de vouloir quitter ?',
    );
  });
});
