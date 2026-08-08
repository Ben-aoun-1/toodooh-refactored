import { describe, expect, it } from 'vitest';

import type { RechargeRow, WalletTransactionRow } from '@/features/wallet/services/wallet.service';

import {
  invoiceRows,
  isExpenseView,
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

  it('an engagement renders with the « Engagé » badge and its OWN tone — informational, the balance has not moved', () => {
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
      tone: 'engaged',
      method: '',
    });
  });

  it('a settlement renders « Réglé » as a debit; a FULLY REFUNDED one renders 0 honestly', () => {
    const settled = transactionView(
      wireRow({ id: 'settlement-s1', type: 'settlement', label: 'ky', amount_tnd: -180 }),
    );
    expect(settled).toMatchObject({ badge: 'Réglé', amountTnd: -180, tone: 'debit' });
    const refunded = transactionView(
      wireRow({ id: 'settlement-s2', type: 'settlement', label: 'khvutfyu', amount_tnd: 0 }),
    );
    expect(refunded).toMatchObject({ badge: 'Réglé', amountTnd: 0, tone: 'credit' });
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

  it('the « Dépenses » tab matches engagements AND settlements, nothing else', () => {
    expect(isExpenseView(transactionView(wireRow({ type: 'engagement', amount_tnd: -1 })))).toBe(
      true,
    );
    expect(isExpenseView(transactionView(wireRow({ type: 'settlement', amount_tnd: -1 })))).toBe(
      true,
    );
    expect(isExpenseView(transactionView(wireRow()))).toBe(false);
    expect(isExpenseView(transactionView(wireRow({ type: 'adjustment', amount_tnd: -1 })))).toBe(
      false,
    );
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
