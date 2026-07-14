// CF-W1 (spec §1.9) — the wizard exit-intercept decisions, extracted pure so the matrix is
// pinned by unit test (no render harness).

/** The popup copy (spec verbatim). */
export const WIZARD_EXIT_MESSAGE =
  'Vous allez perdre définitivement les infos insérées dans cette campagne, êtes-vous sûr de vouloir quitter ?';

export interface ExitGuardInput {
  /** A create-early draft exists (POST already fired). */
  hasDraft: boolean;
  /** The user explicitly saved at least once — OR the wizard opened on a resumed draft. */
  explicitlySaved: boolean;
  /** The editable state differs from the last saved/loaded snapshot. */
  dirtySinceSave: boolean;
}

/**
 * Arm the intercept (popup + beforeunload) when leaving would lose something: a FRESH draft the
 * user never explicitly saved, or unsaved edits on top of any draft (typed-but-not-created
 * counts — the name field is real work too).
 */
export const shouldArmExitGuard = (i: ExitGuardInput): boolean =>
  (i.hasDraft && !i.explicitlySaved) || i.dirtySinceSave;

/**
 * RULED distinction (surfaced in the PR body): Quitter on a FRESH wizard (create-early draft
 * never explicitly saved) DELETES the draft — the spec wants no campaign left behind, not even a
 * brouillon. Quitter on a RESUMED draft only discards the unsaved edits — the draft survives.
 */
export const quitDeletesDraft = (
  i: Pick<ExitGuardInput, 'hasDraft' | 'explicitlySaved'>,
): boolean => i.hasDraft && !i.explicitlySaved;
