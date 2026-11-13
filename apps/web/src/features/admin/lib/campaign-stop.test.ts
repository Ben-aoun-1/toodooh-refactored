import { describe, expect, it } from 'vitest';

import {
  canDeleteCampaign,
  canStopCampaign,
  parseStopReason,
  stopConsequence,
  stopLabel,
  stoppedToast,
} from './campaign-stop';

const row = (
  over: Partial<{ status: string; campaign_type: string; event_id: string | null }> = {},
) => ({
  status: 'active',
  campaign_type: 'standard',
  event_id: null,
  ...over,
});

describe('STOP-1 — « Arrêter la campagne »', () => {
  it('only a superadmin, on an active or upcoming campaign', () => {
    expect(canStopCampaign('superadmin', row())).toBe(true);
    expect(canStopCampaign('superadmin', row({ status: 'upcoming' }))).toBe(true);
    expect(canStopCampaign('admin', row())).toBe(false);
    expect(canStopCampaign('superadmin', row({ status: 'pending' }))).toBe(false);
    expect(canStopCampaign('superadmin', row({ status: 'completed' }))).toBe(false);
  });

  // Mariem 05/11 (ruling 1A) — a match positioning stops too, with its own words.
  it('a match positioning stops too, and the window says its places go back to the match', () => {
    const positioning = row({ campaign_type: 'event', event_id: 'e1', status: 'upcoming' });
    expect(canStopCampaign('superadmin', positioning)).toBe(true);
    expect(canStopCampaign('superadmin', row({ event_id: 'e1' }))).toBe(true);
    expect(stopLabel(positioning)).toBe('Arrêter le positionnement');
    expect(stopLabel(row())).toBe('Arrêter la campagne');
    expect(stopConsequence(positioning)).toContain('ses places reviennent au match');
    expect(stopConsequence({ ...positioning, status: 'active' })).toContain(
      'payés pour les blocs déjà diffusés',
    );
    expect(stopConsequence(row())).toContain('même sous 20 TND');
  });

  it('« Supprimer » only for a superadmin, once the campaign was stopped', () => {
    expect(canDeleteCampaign('superadmin', { stopped_at: '2026-11-06T10:00:00Z' })).toBe(true);
    expect(canDeleteCampaign('admin', { stopped_at: '2026-11-06T10:00:00Z' })).toBe(false);
    expect(canDeleteCampaign('superadmin', { stopped_at: null })).toBe(false);
    expect(canDeleteCampaign('superadmin', {})).toBe(false); // an older api sends no stopped_at
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
