import { describe, expect, it } from 'vitest';

import type { CampaignView } from '@/features/campaigns/services/campaigns.api';
import type { RechargeRow } from '@/features/wallet/services/wallet.service';

import {
  ADJUSTMENT_DESIGNATION,
  RECHARGE_DESIGNATION,
  RECHARGE_PAYMENT_METHOD,
  composeLedger,
  invoiceRows,
  monthlyInvoiceDesignation,
  recapitulatifDesignation,
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

const campaign = (over: Partial<CampaignView> = {}): CampaignView => ({
  id: 'c1',
  name: 'Campagne Été',
  campaign_type: 'standard',
  event_id: null,
  status: 'completed',
  start_date: '2026-06-01',
  end_date: '2026-06-07',
  description: null,
  requested_budget: 300,
  content_validation_status: 'approved',
  submitted_at: null,
  rejected_at: null,
  reject_reason: null,
  creative_id: null,
  created_at: '2026-05-20T09:00:00.000Z',
  updated_at: '2026-06-08T09:00:00.000Z',
  spend_tnd: 240,
  reconciled_at: '2026-06-08T09:00:00.000Z',
  ...over,
});

describe('composeLedger (CF-M1 — live credits/debits, reconciling with /api/wallet/balance)', () => {
  it('credits = CONFIRMED recharges only (pending/rejected rows never enter the ledger)', () => {
    const lines = composeLedger(
      [
        recharge({ id: 'r1', status: 'confirmed' }),
        recharge({ id: 'r2', status: 'pending' }),
        recharge({ id: 'r3', status: 'rejected', reject_reason: 'introuvable' }),
      ],
      [],
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      id: 'r-r1',
      type: 'recharge',
      designation: RECHARGE_DESIGNATION,
      amount: 1000,
      paymentMethod: RECHARGE_PAYMENT_METHOD, // bank transfer is the only recharge channel
    });
  });

  it('credits are dated at CONFIRMATION (when the money entered the balance), not creation', () => {
    const [line] = composeLedger([recharge()], []);
    expect(line?.date.toISOString()).toBe('2026-07-10T10:00:00.000Z');
  });

  it('FCT1 — a bon-method credit carries « Bon de commande »; virement/legacy stay « Virement bancaire »', () => {
    const lines = composeLedger(
      [
        recharge({ id: 'r1', method: 'bon_de_commande' }),
        recharge({ id: 'r2', method: 'virement' }),
        recharge({ id: 'r3', method: null }),
      ],
      [],
    );
    expect(lines.map((l) => l.paymentMethod)).toEqual([
      'Bon de commande',
      RECHARGE_PAYMENT_METHOD,
      RECHARGE_PAYMENT_METHOD,
    ]);
  });

  // ── FCT2 (US-FCT-14) — debits AT LAUNCH DAY, the VISIBLE view ────────────────
  it('debits = LAUNCHED campaigns (active/completed), VISIBLE from and DATED at the start day', () => {
    const lines = composeLedger(
      [],
      [
        campaign({ id: 'c1', status: 'active', spend_tnd: null, reconciled_at: null }),
        // Before the start day: not launched yet → ABSENT (upcoming/pending/draft).
        campaign({ id: 'c2', status: 'upcoming', spend_tnd: null, reconciled_at: null }),
        campaign({ id: 'c3', status: 'pending', spend_tnd: null, reconciled_at: null }),
        campaign({ id: 'c4', status: 'draft', start_date: null }),
      ],
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ id: 'c-c1', type: 'expense', designation: 'Campagne Été' });
    // Dated at the LAUNCH day — never the reconciliation instant.
    expect(lines[0]?.date.toISOString()).toBe('2026-06-01T00:00:00.000Z');
  });

  it('the debit amount: the engaged ask while running, the reconciled NET once settled — the DATE never moves', () => {
    const [running] = composeLedger(
      [],
      [campaign({ status: 'active', spend_tnd: null, reconciled_at: null })],
    );
    expect(running?.amount).toBe(300); // requested_budget — the engaged ask
    const [settled] = composeLedger([], [campaign({ status: 'completed', spend_tnd: 240 })]);
    expect(settled?.amount).toBe(240); // the reconciled NET
    expect(settled?.date.toISOString()).toBe('2026-06-01T00:00:00.000Z'); // still launch day
  });

  it('a zero-spend reconciliation still shows (0 TND settled is a real outcome, not absence)', () => {
    const lines = composeLedger([], [campaign({ spend_tnd: 0 })]);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.amount).toBe(0);
  });

  // ── FCT2 (US-FCT-9) — the THIRD row type: signed admin adjustments ───────────
  it('adjustments: SIGNED rows with the reason surfaced, merged into the ledger', () => {
    const lines = composeLedger(
      [],
      [],
      [
        {
          id: 'a1',
          amount_tnd: 150.5,
          reason: 'Geste commercial',
          created_at: '2026-07-15T10:00:00.000Z',
        },
        { id: 'a2', amount_tnd: -30, reason: 'Trop-perçu', created_at: '2026-07-16T10:00:00.000Z' },
      ],
    );
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({
      id: 'a-a2',
      type: 'adjustment',
      designation: ADJUSTMENT_DESIGNATION,
      amount: -30,
      paymentMethod: 'Trop-perçu',
    });
    expect(lines[1]).toMatchObject({ id: 'a-a1', amount: 150.5 });
  });

  it('merges and sorts newest-first across the THREE kinds', () => {
    const lines = composeLedger(
      [recharge({ id: 'r1', confirmed_at: '2026-07-10T10:00:00.000Z' })],
      [campaign({ id: 'c1', status: 'active', start_date: '2026-07-12' })],
      [{ id: 'a1', amount_tnd: 10, reason: 'x', created_at: '2026-07-11T10:00:00.000Z' }],
    );
    expect(lines.map((l) => l.id)).toEqual(['c-c1', 'a-a1', 'r-r1']);
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
