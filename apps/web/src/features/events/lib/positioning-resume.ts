// Operator ticket 2026-10-09 — « Modifier » on an event positioning opens the LAST step (the
// Récapitulatif and its minutes slider), not Zones. The récap prices the minutes from the spot
// (EVT-PRICE2), so a positioning without a spot yet opens on the Vidéo step instead.

/** The navigation state « Modifier » / « Reprendre » pass to the event parcours. */
export interface PositioningResumeState {
  resumed: true;
  openRecap: true;
}

export const POSITIONING_RESUME_STATE: PositioningResumeState = { resumed: true, openRecap: true };

/** The step a resumed positioning opens on: 3 (récap) with a spot, 2 (vidéo) without, else 1. */
export const resumeStepFor = (state: unknown, creativeId: string | null | undefined): number => {
  const openRecap =
    typeof state === 'object' &&
    state !== null &&
    'openRecap' in state &&
    (state as { openRecap: unknown }).openRecap === true;
  if (!openRecap) return 1;
  return creativeId ? 3 : 2;
};
