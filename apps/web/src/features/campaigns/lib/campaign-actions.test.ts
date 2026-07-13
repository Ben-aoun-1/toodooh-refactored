import { describe, expect, it } from 'vitest';

import { canDeleteDraftCampaign, canResumeCampaign, rejectReasonToShow } from './campaign-actions';

// CF-Q1 — Reprendre/Supprimer are draft-only (the API PATCH/submit 409 anything else), and the
// « Motif du refus » renders only on rejected campaigns that actually carry a stored reason.

describe('canResumeCampaign / canDeleteDraftCampaign (draft-only, mirroring the API 409 gate)', () => {
  it('allows drafts only', () => {
    expect(canResumeCampaign('draft')).toBe(true);
    expect(canDeleteDraftCampaign('draft')).toBe(true);
  });

  it('refuses every non-draft status — pending/rejected/completed dead-end server-side', () => {
    for (const status of ['pending', 'rejected', 'completed', 'active', 'paused']) {
      expect(canResumeCampaign(status)).toBe(false);
      expect(canDeleteDraftCampaign(status)).toBe(false);
    }
  });
});

describe('rejectReasonToShow (« Motif du refus »)', () => {
  it('returns the stored reason for a rejected campaign', () => {
    expect(rejectReasonToShow('rejected', 'Visuel non conforme.')).toBe('Visuel non conforme.');
  });

  it('returns null when the reason is missing or the status is not rejected', () => {
    expect(rejectReasonToShow('rejected', null)).toBeNull();
    expect(rejectReasonToShow('rejected', undefined)).toBeNull();
    expect(rejectReasonToShow('rejected', '')).toBeNull();
    expect(rejectReasonToShow('pending', 'Une raison égarée.')).toBeNull();
    expect(rejectReasonToShow('draft', 'Une raison égarée.')).toBeNull();
  });
});
