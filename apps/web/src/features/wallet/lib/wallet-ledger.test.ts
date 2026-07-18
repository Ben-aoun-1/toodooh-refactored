import { describe, expect, it } from 'vitest';

import type { CampaignView } from '@/features/campaigns/services/campaigns.api';
import type { RechargeRow } from '@/features/wallet/services/wallet.service';

import {
  RECHARGE_DESIGNATION,
  RECHARGE_PAYMENT_METHOD,
  composeLedger,
  invoiceDesignation,
  invoiceRows,
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
  ...over,
});

const campaign = (over: Partial<CampaignView> = {}): CampaignView => ({
  id: 'c1',
  name: 'Campagne Été',
  campaign_type: 'standard',
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

  it('debits = campaigns WITH a reconciled net spend; unreconciled campaigns show no line', () => {
    const lines = composeLedger(
      [],
      [
        campaign({ id: 'c1', spend_tnd: 240 }),
        campaign({ id: 'c2', spend_tnd: null, reconciled_at: null }), // active, not settled
        campaign({ id: 'c3', spend_tnd: undefined, reconciled_at: undefined }), // list variant
      ],
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      id: 'c-c1',
      type: 'expense',
      designation: 'Campagne Été',
      amount: 240,
    });
    expect(lines[0]?.date.toISOString()).toBe('2026-06-08T09:00:00.000Z');
  });

  it('a zero-spend reconciliation still shows (0 TND settled is a real outcome, not absence)', () => {
    const lines = composeLedger([], [campaign({ spend_tnd: 0 })]);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.amount).toBe(0);
  });

  it('merges and sorts newest-first across both kinds', () => {
    const lines = composeLedger(
      [recharge({ id: 'r1', confirmed_at: '2026-07-10T10:00:00.000Z' })],
      [campaign({ id: 'c1', reconciled_at: '2026-07-12T10:00:00.000Z' })],
    );
    expect(lines.map((l) => l.id)).toEqual(['c-c1', 'r-r1']);
  });
});

describe('invoiceRows (CF-M1 — every recharge IS a facture, FCT- reference minted at creation)', () => {
  it('maps the wire rows to the MyInvoices shape, all statuses included', () => {
    const rows = invoiceRows([
      recharge({ id: 'r1', status: 'pending', reference: 'FCT-BBBB2222', amount_tnd: 500 }),
      recharge({ id: 'r2', status: 'confirmed' }),
    ]);
    expect(rows).toEqual([
      {
        id: 'r1',
        numero: 'FCT-BBBB2222',
        montant: 500,
        date_emission: '2026-07-01T10:00:00.000Z',
        statut: 'pending',
      },
      {
        id: 'r2',
        numero: 'FCT-AAAA1111',
        montant: 1000,
        date_emission: '2026-07-01T10:00:00.000Z',
        statut: 'confirmed',
      },
    ]);
  });
});

describe('invoiceDesignation', () => {
  it('renders « Facture <Mois> <Année> » in French from the emission date', () => {
    expect(invoiceDesignation('2026-07-01T10:00:00.000Z')).toBe('Facture Juillet 2026');
    expect(invoiceDesignation('2026-01-15T00:00:00.000Z')).toBe('Facture Janvier 2026');
  });

  it('falls back to « Facture » on an unparseable date', () => {
    expect(invoiceDesignation('not-a-date')).toBe('Facture');
  });
});
