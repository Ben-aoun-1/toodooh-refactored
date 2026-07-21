import { describe, expect, it } from 'vitest';

import {
  STATUS_FILTER_OPTIONS,
  WHOLE_NETWORK_CHIP,
  campaignMatchesCategory,
  categoryFilterOptions,
  statusFilterFromSearch,
} from './campaign-filters';
import { CAMPAIGN_STATUS_UI } from './campaign-status';

// CF-U3 (Mejri items 5/6/7) — the Mes campagnes filter semantics.

describe('campaignMatchesCategory (item 5 — match the TARGETING, not the dead field)', () => {
  it('her repro: a Café-targeted campaign is found under Café', () => {
    expect(campaignMatchesCategory(['Café'], 'Café')).toBe(true);
    expect(campaignMatchesCategory(['Café · premium'], 'Café · premium')).toBe(true);
  });

  it('a differently-targeted campaign is filtered out', () => {
    expect(campaignMatchesCategory(['Resto'], 'Café')).toBe(false);
  });

  it('whole-network campaigns match EVERY category — explicit chip AND zero lines', () => {
    expect(campaignMatchesCategory([WHOLE_NETWORK_CHIP], 'Café')).toBe(true);
    expect(campaignMatchesCategory([], 'Café')).toBe(true);
    expect(campaignMatchesCategory(undefined, 'Café')).toBe(true);
  });

  it('no filter selected matches everything', () => {
    expect(campaignMatchesCategory(['Resto'], '')).toBe(true);
  });
});

describe('categoryFilterOptions', () => {
  it('distinct, fr-sorted, whole-network chip excluded', () => {
    const rows = [
      { selected_categories: ['Resto', 'Café'] },
      { selected_categories: ['Café', WHOLE_NETWORK_CHIP] },
      { selected_categories: [] },
      {},
    ];
    expect(categoryFilterOptions(rows)).toEqual(['Café', 'Resto']);
  });
});

describe('STATUS_FILTER_OPTIONS (item 6 — the CF-S1 single map, no second list)', () => {
  it('exactly the six enum ids, French labels from CAMPAIGN_STATUS_UI', () => {
    expect(STATUS_FILTER_OPTIONS.map((o) => o.value)).toEqual([
      'draft',
      'pending',
      'upcoming',
      'active',
      'rejected',
      'completed',
    ]);
    for (const { value, label } of STATUS_FILTER_OPTIONS) {
      expect(label).toBe(CAMPAIGN_STATUS_UI[value].label);
    }
  });
});

describe('statusFilterFromSearch (item 7 — the ?status= deep link)', () => {
  it('accepts each of the six enum ids', () => {
    for (const { value } of STATUS_FILTER_OPTIONS) {
      expect(statusFilterFromSearch(`?status=${value}`)).toBe(value);
    }
  });

  it('junk and absent apply nothing', () => {
    expect(statusFilterFromSearch('?status=paused')).toBeNull();
    expect(statusFilterFromSearch('?status=')).toBeNull();
    expect(statusFilterFromSearch('')).toBeNull();
    expect(statusFilterFromSearch('?other=1')).toBeNull();
  });
});
