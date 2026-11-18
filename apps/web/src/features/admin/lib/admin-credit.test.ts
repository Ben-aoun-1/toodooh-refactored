import { describe, expect, it } from 'vitest';

import { adminPaymentLabel, methodLabel } from '@/features/wallet/lib/recharge-methods';

import { canCreditAccount, parsePaymentAmount } from './admin-credit';
import { adminRechargeTypeLabel } from './recharge-filters';

describe('ADM-CREDIT1 — « Créditer le compte »', () => {
  it('any positive amount, no ceiling, no minimum; comma or dot; at most 2 decimals', () => {
    expect(parsePaymentAmount('0.01')).toBe(0.01);
    expect(parsePaymentAmount('1250,5')).toBe(1250.5);
    expect(parsePaymentAmount('2 000 000')).toBe(2_000_000);
    expect(parsePaymentAmount('0')).toBeNull();
    expect(parsePaymentAmount('-5')).toBeNull();
    expect(parsePaymentAmount('10.123')).toBeNull();
    expect(parsePaymentAmount('')).toBeNull();
  });

  it('only screencaster accounts can be credited', () => {
    expect(canCreditAccount({ role: 'advertiser' })).toBe(true);
    expect(canCreditAccount({ role: 'individual_owner' })).toBe(false);
    expect(canCreditAccount({ role: 'admin' })).toBe(false);
  });

  it('an admin-recorded payment reads « Paiement reçu · <mode> » for both the admin and the screencaster', () => {
    expect(adminPaymentLabel('ADM-ESP-7K2Q9XWA')).toBe('Paiement reçu · Espèces');
    expect(adminPaymentLabel('ADM-CHQ-AAAA1111')).toBe('Paiement reçu · Chèque');
    expect(adminPaymentLabel('VIR-AAAA1111')).toBeNull();
    expect(methodLabel(null, 'ADM-VIR-AAAA1111')).toBe('Paiement reçu · Virement');
    expect(methodLabel('virement', 'VIR-AAAA1111')).toBe('Virement bancaire');
    expect(methodLabel(null)).toBe('—');
    expect(adminRechargeTypeLabel(null, 'ADM-ESP-AAAA1111')).toBe('Paiement reçu · Espèces');
  });
});
