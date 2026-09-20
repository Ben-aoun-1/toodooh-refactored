import { describe, expect, it } from 'vitest';

import {
  CAMPAIGN_STATUS_IDS,
  CAMPAIGN_STATUS_UI,
  campaignStatusUi,
  isCampaignStatusId,
} from './campaign-status';

// CF-S1 — the SINGLE status map: labels pinned exactly (the grid/list collision and the
// « Terminée »/« Passée » split can never come back), unknowns fall back to draft.

describe('CAMPAIGN_STATUS_UI (single source)', () => {
  it('pins the six ruled labels', () => {
    expect(
      Object.fromEntries(Object.entries(CAMPAIGN_STATUS_UI).map(([k, v]) => [k, v.label])),
    ).toEqual({
      draft: 'Brouillon',
      pending: 'En attente',
      upcoming: 'À venir',
      active: 'Active',
      rejected: 'Non validé',
      completed: 'Passée',
    });
  });

  it('every status carries the card classes AND the drawer palette', () => {
    for (const ui of Object.values(CAMPAIGN_STATUS_UI)) {
      expect(ui.bg).toMatch(/^bg-/);
      expect(ui.text).toMatch(/^text-/);
      expect(ui.dot).toMatch(/^bg-/);
      for (const hex of Object.values(ui.drawer)) expect(hex).toMatch(/^#[0-9A-F]{6}$/i);
    }
  });

  it('unknown/legacy statuses fall back to draft (never crash, never mislabel as rejected)', () => {
    expect(campaignStatusUi('paused').label).toBe('Brouillon');
    expect(campaignStatusUi('').label).toBe('Brouillon');
    expect(campaignStatusUi('upcoming').label).toBe('À venir');
  });

  // ADM-FIX1 — the ids became the RUNTIME list the union derives from, so the map and the
  // narrowing guard can never drift from one another (the admin types carried a 4-valued copy).
  it('the id list and the map cover exactly the same six statuses', () => {
    expect([...CAMPAIGN_STATUS_IDS]).toEqual(Object.keys(CAMPAIGN_STATUS_UI));
    expect(CAMPAIGN_STATUS_IDS).toHaveLength(6);
  });

  it('isCampaignStatusId narrows only the six stored ids', () => {
    for (const id of CAMPAIGN_STATUS_IDS) expect(isCampaignStatusId(id)).toBe(true);
    expect(isCampaignStatusId('paused')).toBe(false);
    expect(isCampaignStatusId('all')).toBe(false);
    expect(isCampaignStatusId('')).toBe(false);
    expect(isCampaignStatusId(null)).toBe(false);
    expect(isCampaignStatusId(undefined)).toBe(false);
  });
});
