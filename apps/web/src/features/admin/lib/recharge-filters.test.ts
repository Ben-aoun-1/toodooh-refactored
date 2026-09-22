import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  computeRechargeStats,
  type AdminRecharge,
} from '@/features/admin/services/admin-recharges.service';
import { RECHARGE_TYPE_LABELS, methodLabel } from '@/features/wallet/lib/recharge-methods';

import {
  DEFAULT_RECHARGE_FILTERS,
  adminRechargeTypeLabel,
  filterRecharges,
  parseRechargeTypeFilter,
  screencasterOptions,
  withRechargeType,
  type RechargeFilters,
} from './recharge-filters';

// RECH-ADM1 — the admin Recharges filters, pure: type (T1), type-dependent status (T2),
// screencaster (T3), reference search (US-FCT-7), and the stat cards over the filtered rows (T4).

const row = (over: Partial<AdminRecharge> = {}): AdminRecharge => ({
  id: 'r1',
  advertiser_id: 'adv-a',
  advertiser_label: 'Café Central',
  advertiser_email: 'central@example.com',
  amount_tnd: 1000,
  status: 'pending',
  reference: 'VIR-AAAA1111',
  reject_reason: null,
  confirmed_at: null,
  confirmed_by: null,
  created_at: '2026-09-20T10:00:00.000Z',
  updated_at: '2026-09-20T10:00:00.000Z',
  has_document: true,
  document_uploaded_at: '2026-09-20T10:00:00.000Z',
  document_mime: 'application/pdf',
  method: 'virement',
  has_bon: false,
  has_signed_bon: false,
  signed_bon_mime: null,
  signed_bon_deposited_at: null,
  cancelled_at: null,
  ...over,
});

const rows: AdminRecharge[] = [
  row({ id: 'v1', reference: 'VIR-AAAA0001', status: 'pending', amount_tnd: 500 }),
  row({ id: 'v2', reference: 'VIR-AAAA0002', status: 'confirmed', amount_tnd: 700 }),
  row({
    id: 'b1',
    reference: 'BC-BBBB0001',
    method: 'bon_de_commande',
    status: 'bon_issued',
    advertiser_id: 'adv-b',
    advertiser_label: 'Pharmacie Nour',
    advertiser_email: 'nour@example.com',
    amount_tnd: 2000,
  }),
  row({
    id: 'b2',
    reference: 'BC-BBBB0002',
    method: 'bon_de_commande',
    status: 'rejected',
    advertiser_id: 'adv-b',
    advertiser_label: 'Pharmacie Nour',
    advertiser_email: 'nour@example.com',
    amount_tnd: 3000,
  }),
  row({
    id: 'f1',
    reference: 'FCT-CCCC0001',
    method: null,
    status: 'confirmed',
    advertiser_id: 'adv-c',
    advertiser_label: 'salma@example.com',
    advertiser_email: 'salma@example.com',
    amount_tnd: 100,
  }),
];

const ids = (list: AdminRecharge[]) => list.map((r) => r.id);
const withFilters = (over: Partial<RechargeFilters>): RechargeFilters => ({
  ...DEFAULT_RECHARGE_FILTERS,
  ...over,
});

describe('filterRecharges', () => {
  it('the defaults keep every row', () => {
    expect(DEFAULT_RECHARGE_FILTERS).toEqual({
      type: 'all',
      status: 'all',
      screencaster: 'all',
      search: '',
    });
    expect(ids(filterRecharges(rows, DEFAULT_RECHARGE_FILTERS))).toEqual([
      'v1',
      'v2',
      'b1',
      'b2',
      'f1',
    ]);
  });

  it('T1 — filters by the type derived from the method (FCT = method NULL)', () => {
    expect(ids(filterRecharges(rows, withFilters({ type: 'VIR' })))).toEqual(['v1', 'v2']);
    expect(ids(filterRecharges(rows, withFilters({ type: 'BC' })))).toEqual(['b1', 'b2']);
    expect(ids(filterRecharges(rows, withFilters({ type: 'FCT' })))).toEqual(['f1']);
  });

  it('filters by the per-type status DISPLAY label (FCT1 vocabulary)', () => {
    expect(ids(filterRecharges(rows, withFilters({ status: 'Bon émis' })))).toEqual(['b1']);
    // « Validée » is the legacy word only — the confirmed virement reads « Créditée ».
    expect(ids(filterRecharges(rows, withFilters({ status: 'Validée' })))).toEqual(['f1']);
    expect(ids(filterRecharges(rows, withFilters({ status: 'Créditée' })))).toEqual(['v2']);
  });

  it('T3 — filters by screencaster id', () => {
    expect(ids(filterRecharges(rows, withFilters({ screencaster: 'adv-b' })))).toEqual([
      'b1',
      'b2',
    ]);
  });

  it('US-FCT-7 — the search stays on the reference only (never the name)', () => {
    expect(ids(filterRecharges(rows, withFilters({ search: '  bbbb0002 ' })))).toEqual(['b2']);
    expect(ids(filterRecharges(rows, withFilters({ search: 'Pharmacie' })))).toEqual([]);
  });

  it('every filter combines (AND)', () => {
    expect(
      ids(
        filterRecharges(
          rows,
          withFilters({ type: 'BC', status: 'Annulée', screencaster: 'adv-b' }),
        ),
      ),
    ).toEqual(['b2']);
    expect(ids(filterRecharges(rows, withFilters({ type: 'VIR', screencaster: 'adv-b' })))).toEqual(
      [],
    );
  });
});

describe('withRechargeType (T2 — never an impossible type × status pair)', () => {
  it('keeps a status label the new type still offers', () => {
    const next = withRechargeType(withFilters({ type: 'VIR', status: 'Annulée' }), 'BC');
    expect(next).toMatchObject({ type: 'BC', status: 'Annulée' });
  });

  it('resets to « Tous les statuts » when the new type does not offer the label', () => {
    expect(withRechargeType(withFilters({ status: 'Créditée' }), 'BC').status).toBe('all');
    expect(withRechargeType(withFilters({ status: 'Bon émis' }), 'FCT').status).toBe('all');
    expect(withRechargeType(withFilters({ status: 'Validée' }), 'VIR').status).toBe('all');
  });

  it('« Tous les types » offers every label, so it keeps any status', () => {
    const next = withRechargeType(withFilters({ type: 'BC', status: 'Bon émis' }), 'all');
    expect(next).toMatchObject({ type: 'all', status: 'Bon émis' });
  });

  it('leaves the screencaster and the search untouched', () => {
    const next = withRechargeType(withFilters({ screencaster: 'adv-b', search: 'BC-' }), 'FCT');
    expect(next).toMatchObject({ screencaster: 'adv-b', search: 'BC-' });
  });
});

describe('parseRechargeTypeFilter (the <select> value, narrowed without a cast)', () => {
  it('accepts the three types and « all »; anything else falls back to « all »', () => {
    expect(parseRechargeTypeFilter('VIR')).toBe('VIR');
    expect(parseRechargeTypeFilter('BC')).toBe('BC');
    expect(parseRechargeTypeFilter('FCT')).toBe('FCT');
    expect(parseRechargeTypeFilter('all')).toBe('all');
    expect(parseRechargeTypeFilter('virement')).toBe('all');
  });
});

describe('screencasterOptions (T3 — the screencasters PRESENT in the list)', () => {
  it('one option per screencaster, labelled with the API label, alphabetical', () => {
    expect(screencasterOptions(rows)).toEqual([
      { id: 'adv-a', label: 'Café Central' },
      { id: 'adv-b', label: 'Pharmacie Nour' },
      { id: 'adv-c', label: 'salma@example.com' },
    ]);
  });

  it('two screencasters sharing a label are told apart by their email', () => {
    const twins = [
      row({
        id: 'x1',
        advertiser_id: 'adv-x',
        advertiser_label: 'Café',
        advertiser_email: 'x@t.tn',
      }),
      row({
        id: 'y1',
        advertiser_id: 'adv-y',
        advertiser_label: 'Café',
        advertiser_email: 'y@t.tn',
      }),
    ];
    expect(screencasterOptions(twins)).toEqual([
      { id: 'adv-x', label: 'Café (x@t.tn)' },
      { id: 'adv-y', label: 'Café (y@t.tn)' },
    ]);
  });

  it('an empty list offers no screencaster', () => {
    expect(screencasterOptions([])).toEqual([]);
  });
});

describe('adminRechargeTypeLabel (the admin Type column — table + details modal)', () => {
  it('a legacy row (method NULL) says « Ancien format (FCT) » — the type filter’s own word', () => {
    expect(adminRechargeTypeLabel(null)).toBe('Ancien format (FCT)');
    expect(adminRechargeTypeLabel(null)).toBe(RECHARGE_TYPE_LABELS.FCT);
  });

  it('a method row keeps its method label', () => {
    expect(adminRechargeTypeLabel('virement')).toBe('Virement bancaire');
    expect(adminRechargeTypeLabel('bon_de_commande')).toBe('Bon de commande');
  });

  it('the screencaster’s shared methodLabel is untouched (MyRecharges still renders « — »)', () => {
    expect(methodLabel(null)).toBe('—');
  });
});

describe('T4 — the stat cards follow the active filters', () => {
  it('one screencaster’s totals, not the platform’s', () => {
    const stats = computeRechargeStats(
      filterRecharges(rows, withFilters({ screencaster: 'adv-b' })),
    );
    expect(stats).toMatchObject({
      total_recharges: 2,
      rejected_count: 1,
      total_amount: 2000,
      rejected_amount: 3000,
    });
  });
});

describe('RechargeManagement wiring (source pins — apps/web has no render harness)', () => {
  const page = readFileSync(
    fileURLToPath(new URL('../pages/RechargeManagement.tsx', import.meta.url)),
    'utf8',
  );

  it('filters through the pure lib and derives the cards from the FILTERED rows (T4)', () => {
    expect(page).toContain('filterRecharges(recharges, filters)');
    expect(page).toContain('computeRechargeStats(filtered)');
    expect(page).not.toContain('computeRechargeStats(recharges)');
  });

  it('names screencasters with the API label — the approved-only identity map is gone (T3)', () => {
    expect(page).not.toContain('useAdvertiserIdentities');
    expect(page).toContain('advertiser_label');
    expect(page).toContain('advertiser_email');
  });

  it('the Type column names legacy rows like the filter does (adminRechargeTypeLabel)', () => {
    expect(page).toContain('adminRechargeTypeLabel(recharge.method)');
    expect(page).not.toContain('methodLabel(');
  });

  it('the person is a « Screencaster », as in the filter — never « Annonceur »', () => {
    expect(page).toMatch(/>\s*Screencaster\s*</);
    expect(page).not.toContain('Annonceur');
  });
});

describe('RechargeDetailsModal wiring (source pins)', () => {
  const modal = readFileSync(
    fileURLToPath(new URL('../components/RechargeDetailsModal.tsx', import.meta.url)),
    'utf8',
  );

  it('the Type line names legacy rows like the table and the filter', () => {
    expect(modal).toContain('adminRechargeTypeLabel(recharge.method)');
    expect(modal).not.toContain('methodLabel(');
  });

  it('the person is a « Screencaster » here too', () => {
    expect(modal).toMatch(/>\s*Screencaster\s*</);
    expect(modal).not.toContain('Annonceur');
  });
});
