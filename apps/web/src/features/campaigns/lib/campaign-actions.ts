// CF-Q1/CF-S1 — campaign action gating, extracted so the rules are pinned by unit test (the
// page has no render-test harness). The API is the source of truth: PATCH /api/campaigns/:id
// and POST /:id/submit accept draft AND rejected (CF-S1 — Non validé is recoverable), so
// « Reprendre » is offered exactly there and nowhere else.

/** Reprendre (wizard re-entry) works end-to-end on drafts and — CF-S1 — rejected campaigns. */
export const canResumeCampaign = (status: string): boolean =>
  status === 'draft' || status === 'rejected';

/** Draft deletion shares the draft-only gate. */
export const canDeleteDraftCampaign = (status: string): boolean => status === 'draft';

/** « Motif du refus » renders only on a rejected campaign that carries a stored reason. */
export const rejectReasonToShow = (
  status: string,
  reason: string | null | undefined,
): string | null => (status === 'rejected' && reason ? reason : null);
