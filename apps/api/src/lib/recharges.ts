import { and, eq, sql } from 'drizzle-orm';

import { db } from '../db/client.js';
import { type Recharge, recharges } from '../db/schema.js';

// Recharge/wallet helpers (L-wallet) shared by the advertiser routes (routes/recharges.ts) and the
// admin moderation surface (routes/admin-recharges.ts) — single source of truth so the two can't drift.

// Max single top-up. A SANITY bound (fat-finger / numeric overflow guard), NOT a pricing rule —
// pricing awaits Youssef. Adjustable; flagged.
export const MAX_RECHARGE_TND = 1_000_000;

// Human invoice reference, DERIVED from the recharge id so it is unique by construction (the id is
// unique) — no separate counter or uniqueness race. FCT- + the first 8 hex of the uuid, uppercased.
export const makeReference = (rechargeId: string): string =>
  `FCT-${rechargeId.replace(/-/g, '').slice(0, 8).toUpperCase()}`;

// A valid top-up amount: finite, strictly positive, within the sanity bound, and at most 2 decimals
// (TND has 1000-millime precision; we cap at the centime/2-decimal the facture prints).
export const isValidAmount = (amount: number): boolean =>
  Number.isFinite(amount) &&
  amount > 0 &&
  amount <= MAX_RECHARGE_TND &&
  Number(amount.toFixed(2)) === amount;

// Advertiser-facing projection (snake_case wire). amount as a number for ergonomics; the exact value
// lives in the numeric column and in SUM(...). validated_by stays internal (admin id is admin-only).
export const rechargeView = (row: Recharge) => ({
  id: row.id,
  amount_tnd: Number(row.amountTnd),
  status: row.status,
  reference: row.reference,
  reject_reason: row.rejectReason,
  confirmed_at: row.confirmedAt,
  created_at: row.createdAt,
  updated_at: row.updatedAt,
});

export type RechargeView = ReturnType<typeof rechargeView>;

// Admin view = the advertiser projection + the owner id and the confirming admin id (audit).
export const adminRechargeView = (row: Recharge) => ({
  ...rechargeView(row),
  advertiser_id: row.advertiserId,
  confirmed_by: row.confirmedBy,
});

export interface WalletBalance {
  balance_tnd: number;
  credited_tnd: number;
  debited_tnd: number;
  currency: 'TND';
}

// DERIVED wallet balance (no stored wallet_balance row). credited = exact SQL SUM over the caller's
// CONFIRMED recharges (coalesced to 0); debited is DEFERRED (campaign spend needs pricing). The
// balance seam is credited − debited — a future debit ledger plugs its own SUM in here, nowhere else.
export const walletBalance = async (advertiserId: string): Promise<WalletBalance> => {
  const [row] = await db
    .select({ credited: sql<string>`coalesce(sum(${recharges.amountTnd}), 0)` })
    .from(recharges)
    .where(and(eq(recharges.advertiserId, advertiserId), eq(recharges.status, 'confirmed')));
  const credited = Number(row?.credited ?? 0);
  const debited = 0;
  return {
    balance_tnd: credited - debited,
    credited_tnd: credited,
    debited_tnd: debited,
    currency: 'TND',
  };
};
