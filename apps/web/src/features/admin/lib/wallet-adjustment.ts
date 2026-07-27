// FCT2 (US-FCT-9) — the « $ » adjustment modal's pure logic + pinned French copy: a SIGNED
// montant (the +/− toggle carries the sign; the input is a positive magnitude) and an OBLIGATOIRE
// raison — the client mirror of the server's isValidAdjustmentAmount/reason gates (no reason → no
// adjustment). The consequence line is chartered copy.

export type AdjustmentSign = 'credit' | 'debit';

export const ADJUSTMENT_CONSEQUENCE_LINE =
  'Cette opération modifie directement le solde du screencaster.';
export const ADJUSTMENT_AMOUNT_ERROR =
  'Le montant doit être un nombre positif avec au plus 2 décimales.';
export const ADJUSTMENT_REASON_ERROR = 'La raison est obligatoire.';

/**
 * Parse the magnitude input + the sign toggle into the SIGNED wire amount.
 * null = invalid (empty, non-numeric, zero/negative magnitude, or more than 2 decimals).
 */
export const parseAdjustmentAmount = (raw: string, sign: AdjustmentSign): number | null => {
  const magnitude = Number.parseFloat(raw);
  if (!Number.isFinite(magnitude) || magnitude <= 0) return null;
  if (Number(magnitude.toFixed(2)) !== magnitude) return null;
  return sign === 'credit' ? magnitude : -magnitude;
};

/** «+150,00 TND» / «−150,00 TND» — the audit display (fr sign convention). */
export const signedAmountLabel = (amount: number): string =>
  `${amount > 0 ? '+' : '−'}${Math.abs(amount).toFixed(2)} TND`;
