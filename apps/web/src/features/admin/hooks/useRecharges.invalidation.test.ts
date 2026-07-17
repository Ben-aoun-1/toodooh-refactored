import { describe, expect, it } from 'vitest';

import { rechargeDecisionInvalidationKeys } from './useRecharges';

// CF-M1 — the admin confirm/reject must reach the advertiser's LIVE money keys (the pre-repoint
// graph invalidated the dead Supabase walletKeys.transactions, so a confirmed transfer never
// surfaced without a hard refresh). Pinned: balance + recharges (ledger and factures derive from
// these) + the dashboard stats whose balance leg is the same live read.
describe('rechargeDecisionInvalidationKeys', () => {
  it('targets the LIVE advertiser money keys, scoped to the recharge owner', () => {
    expect(rechargeDecisionInvalidationKeys('adv-1')).toEqual([
      ['wallet', 'balance', 'adv-1'],
      ['wallet', 'recharges', 'adv-1'],
      ['advertiser', 'dashboardStats', 'adv-1'],
    ]);
  });

  it('never targets the dead Supabase-era keys', () => {
    const flat = rechargeDecisionInvalidationKeys('adv-1').map((k) => k.join('.'));
    expect(flat).not.toContain('wallet.transactions.adv-1');
    expect(flat.some((k) => k.includes('transactions'))).toBe(false);
    expect(flat.some((k) => k.includes('invoices'))).toBe(false);
  });
});
