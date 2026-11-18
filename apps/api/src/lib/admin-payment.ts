import { randomBytes } from 'node:crypto';

import type { NewNotification, Recharge } from '../db/schema.js';

// ADM-CREDIT1 (operator 18/11, rulings A+B / A / no ceiling, migration-free A) — the admin puts
// money into a screencaster's account from the admin, two ways:
//   • « Crédit offert » — a gesture/compensation: the existing FCT2 wallet adjustment (audited,
//     reason mandatory, no document);
//   • « Paiement reçu » — money the screencaster paid OUTSIDE the platform (espèces, chèque,
//     virement collected by the team): recorded as a recharge CONFIRMED at once by the admin, so it
//     follows every recharge rule (history, « Récapitulatif », agent notice). Recharges never
//     invoice — the monthly facture bills what the campaigns spend (FCT2 US-FCT-12).
// No migration (ruling A): the mode rides the reference prefix (ADM-ESP / ADM-CHQ / ADM-VIR),
// confirmed_by is the admin, and the note reaches the screencaster in the notification only.

export const ADMIN_PAYMENT_MODES = ['especes', 'cheque', 'virement'] as const;
export type AdminPaymentMode = (typeof ADMIN_PAYMENT_MODES)[number];

const MODE_PREFIX: Record<AdminPaymentMode, string> = {
  especes: 'ESP',
  cheque: 'CHQ',
  virement: 'VIR',
};

export const ADMIN_PAYMENT_MODE_LABEL: Record<AdminPaymentMode, string> = {
  especes: 'espèces',
  cheque: 'chèque',
  virement: 'virement',
};

/**
 * No business ceiling and no minimum (ruling). The only bound is the column's own capacity,
 * numeric(12,2): below 10 000 000 000 TND, else Postgres refuses the row.
 */
export const ADMIN_AMOUNT_COLUMN_LIMIT = 10_000_000_000;

/** A money amount for the admin paths: finite, at most 2 decimals, within the column. */
const isCentimes = (amount: number): boolean =>
  Number.isFinite(amount) &&
  Math.abs(amount) < ADMIN_AMOUNT_COLUMN_LIMIT &&
  Number(amount.toFixed(2)) === amount;

/** « Paiement reçu »: strictly positive (a recharge is never negative or zero). */
export const isValidAdminPaymentAmount = (amount: number): boolean =>
  isCentimes(amount) && amount > 0;

/** « Crédit offert » / correction: signed, never zero. */
export const isValidAdminAdjustmentAmount = (amount: number): boolean =>
  isCentimes(amount) && amount !== 0;

const REFERENCE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

/** « ADM-ESP-7K2Q9XWA »: the recharge reference of an admin-recorded payment. */
export const adminPaymentReference = (mode: AdminPaymentMode): string => {
  let suffix = '';
  for (const byte of randomBytes(8))
    suffix += REFERENCE_ALPHABET.charAt(byte % REFERENCE_ALPHABET.length);
  return `ADM-${MODE_PREFIX[mode]}-${suffix}`;
};

/** The mode back from a reference, or null for a recharge the screencaster made himself. */
export const adminPaymentModeOf = (reference: string): AdminPaymentMode | null => {
  const m = /^ADM-(ESP|CHQ|VIR)-/.exec(reference);
  if (!m) return null;
  const entry = Object.entries(MODE_PREFIX).find(([, p]) => p === m[1]);
  return entry ? (entry[0] as AdminPaymentMode) : null;
};

const fmtTnd = (amount: number): string =>
  amount.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** The screencaster's notice: the amount, the mode, and the admin's note when there is one. */
export const adminPaymentNotification = (
  row: Pick<Recharge, 'advertiserId' | 'reference' | 'amountTnd'>,
  mode: AdminPaymentMode,
  note: string | null,
): NewNotification => ({
  userId: row.advertiserId,
  type: 'recharge_credited',
  title: 'Paiement reçu, compte crédité',
  body:
    `Nous avons bien reçu votre paiement par ${ADMIN_PAYMENT_MODE_LABEL[mode]} : ` +
    `${fmtTnd(Number(row.amountTnd))} TND ont été crédités sur votre compte (réf. ${row.reference}).` +
    (note ? ` ${note}` : ''),
});
