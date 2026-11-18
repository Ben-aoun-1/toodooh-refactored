import type { AdminPaymentMode } from '@/features/admin/services/admin-recharges.service';

import { parseAdjustmentAmount } from './wallet-adjustment';

// ADM-CREDIT1 (operator 18/11) — « Créditer le compte » from the users list, the pure half:
//   • « Crédit offert » — a gesture: the FCT2 adjustment (reason mandatory, no document);
//   • « Paiement reçu » — money paid outside the platform: a recharge the admin confirms at once.
// No ceiling, no minimum (ruling): any positive amount with at most 2 decimals.

export const PAYMENT_MODE_OPTIONS: readonly { value: AdminPaymentMode; label: string }[] = [
  { value: 'especes', label: 'Espèces' },
  { value: 'cheque', label: 'Chèque' },
  { value: 'virement', label: 'Virement' },
];

export const PAYMENT_CONSEQUENCE_LINE =
  'Le montant est crédité tout de suite et apparaît comme une recharge validée dans l’historique du screencaster.';

export const PAYMENT_AMOUNT_ERROR = 'Le montant doit être supérieur à 0, avec au plus 2 décimales.';

/** The montant input (« 1250,5 » or « 1250.50 ») → TND, or null when invalid. */
export const parsePaymentAmount = (raw: string): number | null =>
  parseAdjustmentAmount(raw.trim().replace(/\s/g, '').replace(',', '.'), 'credit');

/** Only a screencaster account has a wallet to credit. */
export const canCreditAccount = (user: { role: string }): boolean => user.role === 'advertiser';
