import type { NewNotification, WalletAdjustment } from '../db/schema.js';

import { MAX_RECHARGE_TND } from './recharges.js';

// FCT2 (US-FCT-9) — the admin wallet adjustment's pure half: amount rules, wire projections and
// the French notification copy. The balance seam itself lives in lib/recharges.ts walletBalance
// (the third SUM term); the route (routes/admin-wallet.ts) inserts row + notification atomically.

// A valid SIGNED adjustment: finite, NON-ZERO, at most 2 decimals, within the recharge sanity
// bound in magnitude (an adjustment larger than the biggest possible top-up is a fat-finger).
export const isValidAdjustmentAmount = (amount: number): boolean =>
  Number.isFinite(amount) &&
  amount !== 0 &&
  Math.abs(amount) <= MAX_RECHARGE_TND &&
  Number(amount.toFixed(2)) === amount;

/** «+150.00» / «−150.00» — the signed display the notification and the audit share. */
export const signedTnd = (amount: number): string =>
  `${amount > 0 ? '+' : '−'}${Math.abs(amount).toFixed(2)}`;

/** The screencaster's notification for one adjustment (US-FCT-9 chartered copy). */
export const adjustmentNotification = (
  row: Pick<WalletAdjustment, 'advertiserId' | 'reason'>,
  amount: number,
): NewNotification => ({
  userId: row.advertiserId,
  type: 'wallet_adjustment',
  title: 'Ajustement de votre solde',
  body: `Ajustement de votre solde : ${signedTnd(amount)} TND — ${row.reason}`,
});

// Advertiser-facing projection (snake_case wire) — the admin id stays internal; the screencaster
// sees the amount, the reason and the date.
export const adjustmentView = (row: WalletAdjustment) => ({
  id: row.id,
  amount_tnd: Number(row.amountTnd),
  reason: row.reason,
  created_at: row.createdAt,
});

export type AdjustmentView = ReturnType<typeof adjustmentView>;

/** Admin audit projection — the advertiser view + who did it. */
export const adminAdjustmentView = (row: WalletAdjustment) => ({
  ...adjustmentView(row),
  advertiser_id: row.advertiserId,
  admin_id: row.adminId,
});
