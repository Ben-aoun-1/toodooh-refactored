import { and, eq, sql } from 'drizzle-orm';

import { db } from '../db/client.js';
import { type Recharge, campaignReconciliation, campaigns, recharges } from '../db/schema.js';

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

// ── CF-M2 — the bank-transfer justificatif (proof-of-transfer document) ──────
// OPTIONAL always: the admin may confirm a doc-less recharge (admin judgement). Accepted as
// PDF/JPEG/PNG up to 10 MB, byte-sniffed (CF-SH1 posture) — a declared mimetype that does not
// match the bytes is a 400, never stored.
export const MAX_JUSTIFICATIF_BYTES = 10 * 1024 * 1024;

// Declared mime → the stored object's extension. Doubles as the accepted-mime set.
export const JUSTIFICATIF_MIME_TO_EXT: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
};

// One object per recharge, keyed by mime-derived extension: a same-type re-upload overwrites in
// place; a cross-type one writes a new key and the route removes the old object.
export const justificatifKey = (rechargeId: string, mime: string): string =>
  `recharges/${rechargeId}/justificatif.${JUSTIFICATIF_MIME_TO_EXT[mime] ?? 'bin'}`;

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
  // CF-M2 — document presence, never the key (the object is reached only via the presign routes).
  has_document: row.documentKey !== null,
  document_uploaded_at: row.documentUploadedAt,
});

export type RechargeView = ReturnType<typeof rechargeView>;

// Admin view = the advertiser projection + the owner id and the confirming admin id (audit), plus
// the document mime so the review modal can pick its render mode (image inline vs PDF open-in-tab).
export const adminRechargeView = (row: Recharge) => ({
  ...rechargeView(row),
  advertiser_id: row.advertiserId,
  confirmed_by: row.confirmedBy,
  document_mime: row.documentMime,
});

export interface WalletBalance {
  balance_tnd: number;
  credited_tnd: number;
  debited_tnd: number;
  currency: 'TND';
}

// DERIVED wallet balance (no stored wallet_balance row). credited = exact SQL SUM over the caller's
// CONFIRMED recharges; debited = exact SQL SUM of campaign_reconciliation.spend_tnd over the caller's
// RECONCILED campaigns (L-redisp §B.4 plugged the debit seam here). spend_tnd is already the NET the
// advertiser owes (budget − refund), so balance = credited − debited nets the refund automatically —
// no separate credit needed. Idempotent: one reconciliation row per campaign (unique) ⇒ a re-reconcile
// can't double-debit. Both SUMs coalesce to 0. (A future debit ledger plugs its own SUM in here only.)
export const walletBalance = async (advertiserId: string): Promise<WalletBalance> => {
  const [creditRow] = await db
    .select({ credited: sql<string>`coalesce(sum(${recharges.amountTnd}), 0)` })
    .from(recharges)
    .where(and(eq(recharges.advertiserId, advertiserId), eq(recharges.status, 'confirmed')));
  const [debitRow] = await db
    .select({ debited: sql<string>`coalesce(sum(${campaignReconciliation.spendTnd}), 0)` })
    .from(campaignReconciliation)
    .innerJoin(campaigns, eq(campaignReconciliation.campaignId, campaigns.id))
    .where(eq(campaigns.advertiserId, advertiserId));
  const credited = Number(creditRow?.credited ?? 0);
  const debited = Number(debitRow?.debited ?? 0);
  return {
    balance_tnd: credited - debited,
    credited_tnd: credited,
    debited_tnd: debited,
    currency: 'TND',
  };
};
