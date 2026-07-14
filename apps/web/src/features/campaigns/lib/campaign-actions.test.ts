import { describe, expect, it } from 'vitest';

import { canDeleteDraftCampaign, canResumeCampaign, rejectReasonToShow } from './campaign-actions';

// CF-Q1 — Reprendre/Supprimer are draft-only (the API PATCH/submit 409 anything else), and the
// « Motif du refus » renders only on rejected campaigns that actually carry a stored reason.

describe('canResumeCampaign / canDeleteDraftCampaign (mirroring the API gates)', () => {
  it('Reprendre works on drafts AND — CF-S1 — rejected campaigns (recovery end-to-end)', () => {
    expect(canResumeCampaign('draft')).toBe(true);
    expect(canResumeCampaign('rejected')).toBe(true);
    expect(canDeleteDraftCampaign('draft')).toBe(true);
  });

  it('every other status stays non-resumable; deletion stays draft-only', () => {
    for (const status of ['pending', 'upcoming', 'completed', 'active', 'paused']) {
      expect(canResumeCampaign(status)).toBe(false);
    }
    for (const status of ['pending', 'upcoming', 'rejected', 'completed', 'active']) {
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
