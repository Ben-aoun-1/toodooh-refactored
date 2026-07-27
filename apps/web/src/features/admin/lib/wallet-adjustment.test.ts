import { describe, expect, it } from 'vitest';

import {
  ADJUSTMENT_AMOUNT_ERROR,
  ADJUSTMENT_CONSEQUENCE_LINE,
  ADJUSTMENT_REASON_ERROR,
  parseAdjustmentAmount,
  signedAmountLabel,
} from './wallet-adjustment';

// FCT2 (US-FCT-9) — the adjustment modal's pure rules: the client mirror of the server's
// signed-amount gate + the reason-obligatoire rule, and the chartered consequence line.

describe('parseAdjustmentAmount (magnitude + sign toggle → the SIGNED wire amount)', () => {
  it('credits are positive, debits negative', () => {
    expect(parseAdjustmentAmount('150.50', 'credit')).toBe(150.5);
    expect(parseAdjustmentAmount('150.50', 'debit')).toBe(-150.5);
  });

  it('rejects empty, non-numeric, zero/negative magnitudes and >2 decimals', () => {
    expect(parseAdjustmentAmount('', 'credit')).toBeNull();
    expect(parseAdjustmentAmount('abc', 'credit')).toBeNull();
    expect(parseAdjustmentAmount('0', 'credit')).toBeNull();
    expect(parseAdjustmentAmount('-5', 'credit')).toBeNull();
    expect(parseAdjustmentAmount('10.123', 'debit')).toBeNull();
  });
});

describe('the chartered French copy', () => {
  it('pins the consequence line and the two errors', () => {
    expect(ADJUSTMENT_CONSEQUENCE_LINE).toBe(
      'Cette opération modifie directement le solde du screencaster.',
    );
    expect(ADJUSTMENT_REASON_ERROR).toBe('La raison est obligatoire.');
    expect(ADJUSTMENT_AMOUNT_ERROR).toBe(
      'Le montant doit être un nombre positif avec au plus 2 décimales.',
    );
  });

  it('signedAmountLabel renders the ± audit display', () => {
    expect(signedAmountLabel(150.5)).toBe('+150.50 TND');
    expect(signedAmountLabel(-30)).toBe('−30.00 TND');
  });
});
