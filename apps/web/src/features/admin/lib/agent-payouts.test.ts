import { describe, expect, it } from 'vitest';

import { defaultPayoutMonth, payoutBlocker } from './agent-payouts';

describe('AGT-3 — agent payouts view', () => {
  it('defaults to the month that just ended, across a year boundary too', () => {
    expect(defaultPayoutMonth(new Date(2026, 9, 13))).toBe('2026-09');
    expect(defaultPayoutMonth(new Date(2027, 0, 5))).toBe('2026-12');
  });

  it('a Screencaster agent’s payout waits for his invoice; every payout needs a validated RIB', () => {
    const base = {
      status: 'en_preparation' as const,
      invoice_required: true,
      invoice_uploaded_at: null,
      rib_validated: true,
    };
    expect(payoutBlocker(base)).toBe('Facture de l’agent attendue');
    expect(payoutBlocker({ ...base, invoice_uploaded_at: '2026-10-02T10:00:00Z' })).toBeNull();
    expect(payoutBlocker({ ...base, invoice_required: false })).toBeNull();
    expect(payoutBlocker({ ...base, rib_validated: false })).toBe('RIB non validé');
    expect(payoutBlocker({ ...base, status: 'effectue' })).toBeNull();
  });
});
