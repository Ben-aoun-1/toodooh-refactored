import { describe, expect, it } from 'vitest';

import { canStopCampaign, parseStopReason, stoppedToast } from './campaign-stop';

const row = (
  over: Partial<{ status: string; campaign_type: string; event_id: string | null }> = {},
) => ({
  status: 'active',
  campaign_type: 'standard',
  event_id: null,
  ...over,
});

describe('STOP-1 — « Arrêter la campagne »', () => {
  it('only a superadmin, on an active or upcoming standard campaign', () => {
    expect(canStopCampaign('superadmin', row())).toBe(true);
    expect(canStopCampaign('superadmin', row({ status: 'upcoming' }))).toBe(true);
    expect(canStopCampaign('admin', row())).toBe(false);
    expect(canStopCampaign('superadmin', row({ status: 'pending' }))).toBe(false);
    expect(canStopCampaign('superadmin', row({ status: 'completed' }))).toBe(false);
    expect(canStopCampaign('superadmin', row({ campaign_type: 'event' }))).toBe(false);
    expect(canStopCampaign('superadmin', row({ event_id: 'e1' }))).toBe(false);
  });

  it('the reason is 3 to 500 characters, trimmed', () => {
    expect(parseStopReason('  ok ')).toEqual({ ok: false, error: expect.any(String) });
    expect(parseStopReason(' Demande client ')).toEqual({ ok: true, value: 'Demande client' });
    expect(parseStopReason('x'.repeat(501)).ok).toBe(false);
  });

  it('the toast names the refund in TND', () => {
    expect(stoppedToast(30)).toBe('Campagne arrêtée — 30,000 TND remboursés à l’annonceur.');
    expect(stoppedToast(0)).toBe('Campagne arrêtée.');
  });
});
