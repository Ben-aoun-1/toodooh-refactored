import { describe, expect, it } from 'vitest';

import type { ScreencasterCpmRow } from '@/features/admin/services/admin-screencaster-cpm.service';

import {
  allFilteredSelected,
  composeScreencasterCpmPatch,
  draftsAffected,
  filterScreencasters,
  screencasterName,
  setFilteredSelected,
  toggleSelected,
} from './screencaster-cpm';

const row = (over: Partial<ScreencasterCpmRow>): ScreencasterCpmRow => ({
  id: 'id',
  company_name: null,
  contact_name: 'Contact',
  email: 'c@example.com',
  business_type: null,
  status: 'approved',
  cpm_standard_tnd: 15,
  cpm_event_tnd: 15,
  draft_count: 0,
  last_change: null,
  ...over,
});
const rows = [
  row({ id: 'a', company_name: 'Café Médina', email: 'cafe@medina.tn', draft_count: 2 }),
  row({ id: 'b', contact_name: 'Sami Ben Ali', email: 'sami@example.com', draft_count: 1 }),
  row({ id: 'c', company_name: 'Agence Zeta', email: 'zeta@agence.tn' }),
];

describe('screencasterName', () => {
  it('prefers the company, falls back to the contact', () => {
    expect(screencasterName(rows[0]!)).toBe('Café Médina');
    expect(screencasterName(rows[1]!)).toBe('Sami Ben Ali');
  });
});

describe('filterScreencasters — accent- and case-insensitive over company, contact, email', () => {
  it('matches without accents or case', () => {
    expect(filterScreencasters(rows, 'cafe medina').map((r) => r.id)).toEqual(['a']);
    expect(filterScreencasters(rows, 'SAMI').map((r) => r.id)).toEqual(['b']);
    expect(filterScreencasters(rows, 'agence.tn').map((r) => r.id)).toEqual(['c']);
  });
  it('an empty query keeps everything', () => {
    expect(filterScreencasters(rows, '  ')).toHaveLength(3);
  });
});

describe('selection', () => {
  it('toggles one id', () => {
    expect([...toggleSelected(new Set(['a']), 'b')].sort()).toEqual(['a', 'b']);
    expect([...toggleSelected(new Set(['a']), 'a')]).toEqual([]);
  });
  it('« tout sélectionner » acts on the FILTERED rows only, keeping other selections', () => {
    const filtered = filterScreencasters(rows, 'cafe');
    expect([...setFilteredSelected(new Set(['b']), filtered, true)].sort()).toEqual(['a', 'b']);
    expect([...setFilteredSelected(new Set(['a', 'b']), filtered, false)]).toEqual(['b']);
    expect(allFilteredSelected(new Set(['a']), filtered)).toBe(true);
    expect(allFilteredSelected(new Set(['a']), [])).toBe(false);
  });
  it('counts the drafts the change will re-price', () => {
    expect(draftsAffected(rows, new Set(['a', 'b']))).toBe(3);
  });
});

describe('composeScreencasterCpmPatch', () => {
  it('sends only the rates typed, accepting a French decimal comma', () => {
    expect(composeScreencasterCpmPatch(['a'], '12,5', '')).toEqual({
      ok: true,
      body: { user_ids: ['a'], standard_cpm_tnd: 12.5 },
    });
    expect(composeScreencasterCpmPatch(['a', 'b'], '', '20')).toEqual({
      ok: true,
      body: { user_ids: ['a', 'b'], event_cpm_tnd: 20 },
    });
  });
  it('refuses no selection, no rate, or a non-positive rate', () => {
    expect(composeScreencasterCpmPatch([], '10', '')).toEqual({
      ok: false,
      error: 'Sélectionnez au moins un screencaster',
    });
    expect(composeScreencasterCpmPatch(['a'], ' ', '')).toEqual({
      ok: false,
      error: 'Saisissez au moins un CPM',
    });
    expect(composeScreencasterCpmPatch(['a'], '0', '')).toEqual({
      ok: false,
      error: 'Le CPM doit être un nombre strictement positif',
    });
    expect(composeScreencasterCpmPatch(['a'], 'abc', '')).toEqual({
      ok: false,
      error: 'Le CPM doit être un nombre strictement positif',
    });
  });
  it('refuses more than 3 decimals of PRECISION (api parity — Number(n.toFixed(3)) === n), 3 decimals stay accepted', () => {
    expect(composeScreencasterCpmPatch(['a'], '12,3456', '')).toEqual({
      ok: false,
      error: 'Le CPM doit avoir au plus 3 décimales',
    });
    expect(composeScreencasterCpmPatch(['a'], '12,345', '')).toEqual({
      ok: true,
      body: { user_ids: ['a'], standard_cpm_tnd: 12.345 },
    });
  });
  it('accepts trailing-zero digits the api would too — the check is on the NUMBER, not the typed string', () => {
    expect(composeScreencasterCpmPatch(['a'], '12,3400', '')).toEqual({
      ok: true,
      body: { user_ids: ['a'], standard_cpm_tnd: 12.34 },
    });
    expect(composeScreencasterCpmPatch(['a'], '0,0010', '')).toEqual({
      ok: true,
      body: { user_ids: ['a'], standard_cpm_tnd: 0.001 },
    });
  });
  it('refuses a rate over the api cap (1 000 000), the cap itself stays accepted', () => {
    expect(composeScreencasterCpmPatch(['a'], '1000001', '')).toEqual({
      ok: false,
      error: 'Le CPM doit être inférieur ou égal à 1 000 000',
    });
    expect(composeScreencasterCpmPatch(['a'], '1000000', '')).toEqual({
      ok: true,
      body: { user_ids: ['a'], standard_cpm_tnd: 1000000 },
    });
  });
});
