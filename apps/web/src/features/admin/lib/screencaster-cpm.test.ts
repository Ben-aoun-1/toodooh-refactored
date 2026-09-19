import { describe, expect, it } from 'vitest';

import type { ScreencasterCpmRow } from '@/features/admin/services/admin-screencaster-cpm.service';

import {
  allFilteredSelected,
  composeScreencasterCpmPatch,
  confirmationSummary,
  draftsAffected,
  filterScreencasters,
  formatCpm,
  MAX_SCREENCASTERS_PER_CHANGE,
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
  it('folds only the combining accents — a decomposed query matches, ordinary letters stay', () => {
    expect(filterScreencasters(rows, 'Me\u0301dina').map((r) => r.id)).toEqual(['a']);
    expect(filterScreencasters(rows, 'zeta').map((r) => r.id)).toEqual(['c']);
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
  it('refuses more than 500 screencasters at once (the api cap « tout sélectionner » can pass)', () => {
    const ids = (n: number) => Array.from({ length: n }, (_, i) => `id-${i}`);
    expect(MAX_SCREENCASTERS_PER_CHANGE).toBe(500);
    expect(composeScreencasterCpmPatch(ids(501), '10', '')).toEqual({
      ok: false,
      error: 'Sélectionnez au plus 500 screencasters à la fois',
    });
    expect(composeScreencasterCpmPatch(ids(500), '10', '')).toEqual({
      ok: true,
      body: { user_ids: ids(500), standard_cpm_tnd: 10 },
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

describe('confirmationSummary — the confirmation text, built from a FROZEN patch body', () => {
  it('both rates set: names each rate with 3 decimals and a French comma', () => {
    expect(
      confirmationSummary(
        { user_ids: ['a', 'b', 'c'], standard_cpm_tnd: 12.5, event_cpm_tnd: 20 },
        4,
      ),
    ).toBe(
      'Appliquer à 3 screencasters : CPM standard → 12,500 TND / 1000 · ' +
        'CPM événement → 20,000 TND / 1000. Les brouillons de ces screencasters (4) passent au ' +
        'nouveau CPM, ainsi que leurs prochaines campagnes. Les campagnes en attente, refusées, ' +
        'programmées, actives et terminées gardent leur prix.',
    );
  });
  it('one rate set: the untouched rate reads « inchangé »', () => {
    expect(confirmationSummary({ user_ids: ['a', 'b'], standard_cpm_tnd: 12.5 }, 4)).toBe(
      'Appliquer à 2 screencasters : CPM standard → 12,500 TND / 1000 · CPM événement inchangé. ' +
        'Les brouillons de ces screencasters (4) passent au nouveau CPM, ainsi que leurs ' +
        'prochaines campagnes. Les campagnes en attente, refusées, programmées, actives et ' +
        'terminées gardent leur prix.',
    );
  });
  it('singular: 1 screencaster, 1 brouillon — « ses » prochaines campagnes', () => {
    expect(confirmationSummary({ user_ids: ['a'], standard_cpm_tnd: 12.5 }, 1)).toBe(
      'Appliquer à 1 screencaster : CPM standard → 12,500 TND / 1000 · CPM événement inchangé. ' +
        'Le brouillon de ce screencaster (1) passe au nouveau CPM, ainsi que ses prochaines ' +
        'campagnes. Les campagnes en attente, refusées, programmées, actives et terminées ' +
        'gardent leur prix.',
    );
  });
  it('zero drafts: says so, and only the next campaigns take the new CPM', () => {
    expect(confirmationSummary({ user_ids: ['a'], event_cpm_tnd: 20 }, 0)).toBe(
      'Appliquer à 1 screencaster : CPM standard inchangé · CPM événement → 20,000 TND / 1000. ' +
        'Aucun brouillon à re-tarifer ; ses prochaines campagnes prendront le nouveau CPM. ' +
        'Les campagnes en attente, refusées, programmées, actives et terminées gardent leur prix.',
    );
    expect(confirmationSummary({ user_ids: ['a', 'b'], standard_cpm_tnd: 9 }, 0)).toBe(
      'Appliquer à 2 screencasters : CPM standard → 9,000 TND / 1000 · CPM événement inchangé. ' +
        'Aucun brouillon à re-tarifer ; leurs prochaines campagnes prendront le nouveau CPM. ' +
        'Les campagnes en attente, refusées, programmées, actives et terminées gardent leur prix.',
    );
  });
});

describe('formatCpm — the table and the confirmation render a rate the same way', () => {
  it('3 decimals with a French decimal comma', () => {
    expect(formatCpm(12.5)).toBe('12,500');
    expect(formatCpm(15)).toBe('15,000');
    expect(formatCpm(0.001)).toBe('0,001');
  });
});
