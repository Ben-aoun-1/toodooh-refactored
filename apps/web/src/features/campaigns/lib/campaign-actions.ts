// CF-Q1 — campaign action gating, extracted so the rules are pinned by unit test (the page has
// no render-test harness). The API is the source of truth here: PATCH /api/campaigns/:id and
// POST /:id/submit are draft-only (409 CONFLICT otherwise), so « Reprendre » must never be
// offered on a non-draft — the flow dead-ends server-side.

/** Reprendre (wizard re-entry) works end-to-end ONLY on drafts. */
export const canResumeCampaign = (status: string): boolean => status === 'draft';

/** Draft deletion shares the draft-only gate. */
export const canDeleteDraftCampaign = (status: string): boolean => status === 'draft';

/** « Motif du refus » renders only on a rejected campaign that carries a stored reason. */
export const rejectReasonToShow = (
  status: string,
  reason: string | null | undefined,
): string | null => (status === 'rejected' && reason ? reason : null);
