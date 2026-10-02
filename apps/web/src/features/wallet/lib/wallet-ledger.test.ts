import { describe, expect, it } from 'vitest';

import type { RechargeRow, WalletTransactionRow } from '@/features/wallet/services/wallet.service';

import {
  LEDGER_FILTERS,
  invoiceRows,
  matchesLedgerFilter,
  monthlyInvoiceDesignation,
  recapitulatifDesignation,
  transactionView,
} from './wallet-ledger';

const recharge = (over: Partial<RechargeRow> = {}): RechargeRow => ({
  id: 'r1',
  amount_tnd: 1000,
  status: 'confirmed',
  reference: 'FCT-AAAA1111',
  reject_reason: null,
  confirmed_at: '2026-07-10T10:00:00.000Z',
  created_at: '2026-07-01T10:00:00.000Z',
  updated_at: '2026-07-10T10:00:00.000Z',
  has_document: false,
  document_uploaded_at: null,
  method: null,
  has_bon: false,
  has_signed_bon: false,
  signed_bon_deposited_at: null,
  cancelled_at: null,
  ...over,
});

const wireRow = (over: Partial<WalletTransactionRow> = {}): WalletTransactionRow => ({
  id: 'recharge-r1',
  type: 'recharge',
  label: 'Rechargement wallet',
  amount_tnd: 1000,
  date: '2026-07-10T10:00:00.000Z',
  campaign_id: null,
  detail: 'Virement bancaire',
  ...over,
});

// FIX2 — composeLedger (the client-side derivation over recharges + campaigns) is RETIRED: the
// ledger is SERVED (GET /api/wallet/transactions) and rendered VERBATIM. What remains pinned
// here is the pure VIEW mapping: sign and type come FROM THE WIRE, never re-derived.
describe('transactionView (FIX2 — the verbatim view over the served ledger)', () => {
  it('a recharge renders as a credit with its payment method', () => {
    const view = transactionView(wireRow());
    expect(view).toMatchObject({
      type: 'recharge',
      designation: 'Rechargement wallet',
      badge: null,
      amountTnd: 1000,
      method: 'Virement bancaire',
      tone: 'credit',
    });
    expect(view.date.toISOString()).toBe('2026-07-10T10:00:00.000Z');
  });

  it('LEDG-1 — an engagement renders « Engagé » as a real debit (red, ruling 5A)', () => {
    const view = transactionView(
      wireRow({
        id: 'engagement-c1',
        type: 'engagement',
        label: 'FT1',
        amount_tnd: -300,
        campaign_id: 'c1',
        detail: null,
      }),
    );
    expect(view).toMatchObject({
      designation: 'FT1',
      badge: 'Engagé',
      amountTnd: -300,
      tone: 'debit',
      method: '',
    });
  });

  it('LEDG-1 — a refund renders « Remboursé » as a credit (green, ruling 5A)', () => {
    const refund = transactionView(
      wireRow({ id: 'refund-s1', type: 'refund', label: 'ky', amount_tnd: 70, campaign_id: 'c1' }),
    );
    expect(refund).toMatchObject({ badge: 'Remboursé', amountTnd: 70, tone: 'credit' });
  });

  it('adjustments keep their SIGN and surface the reason as the method column', () => {
    const negative = transactionView(
      wireRow({
        id: 'adjustment-a1',
        type: 'adjustment',
        amount_tnd: -25.25,
        detail: 'Trop-perçu',
      }),
    );
    expect(negative).toMatchObject({ amountTnd: -25.25, tone: 'debit', method: 'Trop-perçu' });
    const positive = transactionView(
      wireRow({
        id: 'adjustment-a2',
        type: 'adjustment',
        amount_tnd: 40,
        detail: 'Geste commercial',
      }),
    );
    expect(positive).toMatchObject({ amountTnd: 40, tone: 'credit' });
  });

  it('LEDG-1 ruling 4A — the filters are Tous / Recharges / Engagements / Remboursements / Ajustements', () => {
    expect(LEDGER_FILTERS.map((f) => f.label)).toEqual([
      'Tous',
      'Recharges',
      'Engagements',
      'Remboursements',
      'Ajustements',
    ]);
  });

  it('each filter matches exactly its own row type; « Tous » matches everything', () => {
    const rows = {
      recharge: transactionView(wireRow()),
      engagement: transactionView(wireRow({ type: 'engagement', amount_tnd: -1 })),
      refund: transactionView(wireRow({ type: 'refund', amount_tnd: 1 })),
      adjustment: transactionView(wireRow({ type: 'adjustment', amount_tnd: -1 })),
    };
    const matched = (f: Parameters<typeof matchesLedgerFilter>[1]) =>
      Object.entries(rows)
        .filter(([, v]) => matchesLedgerFilter(v, f))
        .map(([k]) => k);
    expect(matched('all')).toEqual(['recharge', 'engagement', 'refund', 'adjustment']);
    expect(matched('recharges')).toEqual(['recharge']);
    expect(matched('engagements')).toEqual(['engagement']);
    expect(matched('refunds')).toEqual(['refund']);
    expect(matched('adjustments')).toEqual(['adjustment']);
  });
});

describe('invoiceRows (FCT2 — every recharge HAS a récapitulatif; the real factures are monthly)', () => {
  it('maps the wire rows to the MyInvoices shape, all statuses included', () => {
    const rows = invoiceRows([
      recharge({ id: 'r1', status: 'pending', reference: 'FCT-BBBB2222', amount_tnd: 500 }),
      recharge({ id: 'r2', status: 'confirmed', has_document: true }),
    ]);
    expect(rows).toEqual([
      {
        id: 'r1',
        numero: 'FCT-BBBB2222',
        montant: 500,
        date_emission: '2026-07-01T10:00:00.000Z',
        statut: 'pending',
        has_document: false,
      },
      {
        id: 'r2',
        numero: 'FCT-AAAA1111',
        montant: 1000,
        date_emission: '2026-07-01T10:00:00.000Z',
        statut: 'confirmed',
        has_document: true,
      },
    ]);
  });
});

describe('the FCT2 relabel — récapitulatif vs the real monthly facture', () => {
  it('recapitulatifDesignation renders « Récapitulatif de commande — <Mois> <Année> » (never « Facture »)', () => {
    expect(recapitulatifDesignation('2026-07-01T10:00:00.000Z')).toBe(
      'Récapitulatif de commande — Juillet 2026',
    );
    expect(recapitulatifDesignation('not-a-date')).toBe('Récapitulatif de commande');
    expect(recapitulatifDesignation('2026-07-01T10:00:00.000Z')).not.toContain('Facture');
  });

  it('monthlyInvoiceDesignation renders « Facture <Mois> <Année> » from the YYYY-MM month key', () => {
    expect(monthlyInvoiceDesignation('2026-07')).toBe('Facture Juillet 2026');
    expect(monthlyInvoiceDesignation('2026-01')).toBe('Facture Janvier 2026');
    expect(monthlyInvoiceDesignation('nope')).toBe('Facture');
  });
});
