import { describe, expect, it } from 'vitest';

import { CAMPAIGN_STATUS_UI, campaignStatusUi } from './campaign-status';

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
});
