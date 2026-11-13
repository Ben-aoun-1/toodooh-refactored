// CF-W1 (spec §1.9) — the wizard exit-intercept decisions, extracted pure so the matrix is
// pinned by unit test (no render harness).

/** The popup copy (spec verbatim) — the event positionings' popup keeps it. */
export const WIZARD_EXIT_MESSAGE =
  'Vous allez perdre définitivement les infos insérées dans cette campagne, êtes-vous sûr de vouloir quitter ?';
/**
 * DISP-TOURS §3.1 (Mariem 03/11) — « Quitter une campagne incomplète propose : enregistrer en
 * brouillon ou supprimer définitivement. » The campaign wizard's popup over a draft.
 */
export const DRAFT_EXIT_MESSAGE =
  'Vous quittez la création de cette campagne. Voulez-vous l’enregistrer en brouillon ou la supprimer définitivement ?';
/** A refused campaign being corrected is no draft (and only a draft can be deleted). */
export const EDITS_EXIT_MESSAGE =
  'Vos modifications non enregistrées seront perdues. Voulez-vous les enregistrer avant de quitter ?';

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
 * DISP-TOURS §3.1 — Quitter on a DRAFT deletes it for good, made now or resumed (the popup's
 * « Supprimer définitivement »; the other choice is « Enregistrer en brouillon »). On a refused
 * campaign being corrected (« Non validé », editingStatus 'rejected') it only drops the unsaved
 * edits. Replaces CF-W1's fresh-vs-resumed distinction.
 */
export const quitDeletesDraft = (i: {
  hasDraft: boolean;
  /** The status of the campaign the wizard opened on; null = a campaign made in this wizard. */
  editingStatus: string | null;
}): boolean => i.hasDraft && editsADraft(i.editingStatus);

/** The wizard is on a draft (made in it, or resumed) — not on a refused campaign being corrected. */
export function editsADraft(editingStatus: string | null): boolean {
  return editingStatus === null || editingStatus === 'draft';
}
