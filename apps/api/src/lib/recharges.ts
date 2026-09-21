import { randomBytes } from 'node:crypto';

import { type SQL, and, eq, gte, inArray, isNull, ne, sql } from 'drizzle-orm';

import { db } from '../db/client.js';
import {
  type Recharge,
  campaignReconciliation,
  campaigns,
  recharges,
  users,
  walletAdjustments,
} from '../db/schema.js';

import { tunisDateOf } from './campaign-dates.js';
import type { DbExecutor } from './dispatch/pool.js';
import { type UserLabelSource, userLabel } from './user-label.js';

// Recharge/wallet helpers (L-wallet) shared by the advertiser routes (routes/recharges.ts) and the
// admin moderation surface (routes/admin-recharges.ts) — single source of truth so the two can't drift.

// Max single top-up. A SANITY bound (fat-finger / numeric overflow guard), NOT a pricing rule —
// pricing awaits Youssef. Adjustable; flagged.
export const MAX_RECHARGE_TND = 1_000_000;

// FCT1 (US-FCT-2) — the per-demande floor for BOTH v2 methods, server-enforced at creation. Legacy
// rows predate it and render as-found; the retired generic POST had no floor beyond > 0.
export const MIN_RECHARGE_TND = 500;

// Human invoice reference, DERIVED from the recharge id so it is unique by construction (the id is
// unique) — no separate counter or uniqueness race. FCT- + the first 8 hex of the uuid, uppercased.
// LEGACY (pre-FCT1) — kept so existing rows' references stay decodable; v2 rows use
// makeMethodReference below.
export const makeReference = (rechargeId: string): string =>
  `FCT-${rechargeId.replace(/-/g, '').slice(0, 8).toUpperCase()}`;

// FCT1 — v2 references: VIR-/BC- + 8 uppercase alphanumerics, RANDOM (not id-derived: the chartered
// format spans the full A-Z0-9 alphabet, which 8 hex chars can't reach). Uniqueness rests on the
// column's UNIQUE constraint — the caller retries on a 23505 collision (~36⁻⁸ per attempt).
const REFERENCE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
export const REFERENCE_PATTERN = /^(VIR|BC)-[A-Z0-9]{8}$/;
export const makeMethodReference = (method: 'virement' | 'bon_de_commande'): string => {
  const prefix = method === 'virement' ? 'VIR' : 'BC';
  const bytes = randomBytes(8);
  let suffix = '';
  for (const byte of bytes) suffix += REFERENCE_ALPHABET.charAt(byte % REFERENCE_ALPHABET.length);
  return `${prefix}-${suffix}`;
};

// The house 23505 detection (reconcile-service/dispatch-service idiom) — the reference-collision
// retry loop keys on it.
export const isUniqueViolation = (err: unknown): boolean =>
  (err as { code?: string }).code === '23505';

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

// ── FCT1 — bon de commande objects ───────────────────────────────────────────
// The GENERATED bon is always a PDF at a fixed key (re-rendered on a reference-collision retry, the
// same key overwrites in place). The SIGNED bon follows the justificatif idiom exactly — same
// accepted-mime set, mime-derived extension.
export const bonKey = (rechargeId: string): string => `recharges/${rechargeId}/bon.pdf`;
export const signedBonKey = (rechargeId: string, mime: string): string =>
  `recharges/${rechargeId}/bon-signe.${JUSTIFICATIF_MIME_TO_EXT[mime] ?? 'bin'}`;

// FCT1 — the admin-actionable predicate, ONE home so confirm/reject can't drift: a virement (and a
// legacy method-less row) is decidable while 'pending'; a bon only once the signed bon is deposited
// ('bon_returned'). 'bon_issued' is NOT decidable — GREEN2 (ruled) shows those rows in the admin
// queue READ-ONLY (« Bon émis »), and this predicate is what keeps confirm/reject off them.
export const isAdminDecidable = (row: Pick<Recharge, 'method' | 'status'>): boolean =>
  row.method === 'bon_de_commande' ? row.status === 'bon_returned' : row.status === 'pending';

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
  // FCT1 — method + bon-object presence (keys stay internal, same posture as the justificatif).
  method: row.method,
  has_bon: row.bonKey !== null,
  has_signed_bon: row.signedBonKey !== null,
  signed_bon_deposited_at: row.signedBonDepositedAt,
  cancelled_at: row.cancelledAt,
});

export type RechargeView = ReturnType<typeof rechargeView>;

// RECH-ADM1 (T3) — who a recharge belongs to, as the admin sees it: ADM-FIX1's ONE label
// (lib/user-label) + the email. The admin page used to name screencasters from the APPROVED users
// only, so a pending/rejected/banned screencaster's recharge printed a raw uuid.
export interface RechargeAdvertiser {
  label: string;
  email: string;
}

export const rechargeAdvertiser = (user: UserLabelSource): RechargeAdvertiser => ({
  label: userLabel(user),
  email: user.email,
});

/**
 * The same identity for ONE advertiser id — for the confirm/reject responses, which
 * update-and-return a row and have no join to ride on. They pass their transaction as `executor`:
 * the read belongs to the decision, so a failed read rolls the decision back instead of turning an
 * already-committed credit/cancellation into a 500. A missing user (impossible: advertiser_id is a
 * NOT NULL FK) falls back to the id, never an empty label.
 */
export const rechargeAdvertiserById = async (
  advertiserId: string,
  executor: DbExecutor = db,
): Promise<RechargeAdvertiser> => {
  const [row] = await executor
    .select({
      businessName: users.businessName,
      contactName: users.contactName,
      email: users.email,
    })
    .from(users)
    .where(eq(users.id, advertiserId))
    .limit(1);
  return row
    ? rechargeAdvertiser({ id: advertiserId, ...row })
    : { label: advertiserId, email: '' };
};

// Admin view = the advertiser projection + the owner id and the confirming admin id (audit), plus
// the document mimes so the review modal can pick its render mode (image inline vs PDF open-in-tab).
// RECH-ADM1 — plus the owner's label + email (the « Screencaster » column and filter).
export const adminRechargeView = (row: Recharge, advertiser: RechargeAdvertiser) => ({
  ...rechargeView(row),
  advertiser_id: row.advertiserId,
  advertiser_label: advertiser.label,
  advertiser_email: advertiser.email,
  confirmed_by: row.confirmedBy,
  document_mime: row.documentMime,
  signed_bon_mime: row.signedBonMime,
});

export interface WalletBalance {
  balance_tnd: number;
  credited_tnd: number;
  debited_tnd: number;
  /** FCT2 — the SIGNED sum of admin wallet adjustments (US-FCT-9; audited, reason-required). */
  adjustments_tnd: number;
  currency: 'TND';
}

// DERIVED wallet balance (no stored wallet_balance row). credited = exact SQL SUM over the caller's
// CONFIRMED recharges; debited = exact SQL SUM of campaign_reconciliation.spend_tnd over the caller's
// RECONCILED campaigns (L-redisp §B.4 plugged the debit seam here). spend_tnd is already the NET the
// advertiser owes (budget − refund), so balance = credited − debited nets the refund automatically —
// no separate credit needed. Idempotent: one reconciliation row per campaign (unique) ⇒ a re-reconcile
// can't double-debit. All SUMs coalesce to 0.
//
// FCT2 (US-FCT-9) — the third term: + SUM(wallet_adjustments.amount_tnd), SIGNED. This is the ONE
// seam the adjustments join; the three funded gates (cart confirm, activation, boost) read
// balance_tnd and therefore see adjustments automatically — their read-only posture (no
// reservation, debit at reconciliation only) is BYTE-UNTOUCHED.
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
  const [adjustmentRow] = await db
    .select({ adjustments: sql<string>`coalesce(sum(${walletAdjustments.amountTnd}), 0)` })
    .from(walletAdjustments)
    .where(eq(walletAdjustments.advertiserId, advertiserId));
  const credited = Number(creditRow?.credited ?? 0);
  const debited = Number(debitRow?.debited ?? 0);
  const adjustments = Number(adjustmentRow?.adjustments ?? 0);
  return {
    balance_tnd: credited - debited + adjustments,
    credited_tnd: credited,
    debited_tnd: debited,
    adjustments_tnd: adjustments,
    currency: 'TND',
  };
};

// ── FIX2 (Option A ruling) — reservation semantics over the SAME derived wallet ─────────────────
// A confirmed campaign that has not settled yet is ENGAGED: its GROSS requested budget is spoken
// for (conservative by ruling — refunds come back at settlement, not before). The engaged set is
// DERIVABLE, no new table: campaigns in a confirmed status with NO reconciliation row AND a
// diffusion window that has NOT ENDED (FIX2b — end_date ≥ Tunis today, the lifecycle tick's own
// calendar). An ENDED-unreconciled campaign is a SETTLEMENT matter, not a reservation: on a prod
// where settlements have not run, the unwindowed predicate swept every historical campaign as a
// zombie engagement (Σ = the whole confirmed history, spendable −14 462 on the test account) and
// blocked all new spend. A confirmed row with a NULL end date has no live window and is likewise
// not engaged (same limbo class, settled by the settlement lane). Event positionings ride the
// same campaigns table (EV3) and boosts fold into requested_budget (CF-B1), so ONE predicate
// covers all three.
export const ENGAGED_CAMPAIGN_STATUSES = ['pending', 'upcoming', 'active', 'completed'] as const;

/**
 * The engaged-set predicate — ONE home shared by walletSpendable, the ledger's « Engagé » rows
 * and the admin queue figure, so the gates and every display move together by construction.
 */
export const engagedCampaignConditions = (
  advertiserId: string,
  excludeCampaignId?: string,
  now: Date = new Date(),
): SQL[] => {
  const conditions: SQL[] = [
    eq(campaigns.advertiserId, advertiserId),
    inArray(campaigns.status, [...ENGAGED_CAMPAIGN_STATUSES]),
    isNull(campaignReconciliation.id),
    // FIX2b — the window clause: engaged only while the diffusion window is open.
    gte(campaigns.endDate, tunisDateOf(now)),
  ];
  if (excludeCampaignId !== undefined) conditions.push(ne(campaigns.id, excludeCampaignId));
  return conditions;
};

export interface WalletSpendable extends WalletBalance {
  /** Σ GROSS requested budgets of confirmed-but-unsettled campaigns (event positionings included). */
  engaged_tnd: number;
  /** What the advertiser can still commit: balance − engaged. THE funded-gate figure. */
  spendable_tnd: number;
}

/**
 * FIX2 — THE money seam every funded gate reads (cart confirm, activation, boost, event boost)
 * and the « Solde disponible » display renders. `excludeCampaignId` exists for the ACTIVATION
 * gate only: the campaign being activated is already in the engaged set, and counting its own
 * budget against itself would double-charge it.
 */
export const walletSpendable = async (
  advertiserId: string,
  opts: { excludeCampaignId?: string } = {},
): Promise<WalletSpendable> => {
  const base = await walletBalance(advertiserId);
  const [row] = await db
    .select({ engaged: sql<string>`coalesce(sum(${campaigns.requestedBudget}), 0)` })
    .from(campaigns)
    .leftJoin(campaignReconciliation, eq(campaignReconciliation.campaignId, campaigns.id))
    .where(and(...engagedCampaignConditions(advertiserId, opts.excludeCampaignId)));
  const engaged = Number(row?.engaged ?? 0);
  return { ...base, engaged_tnd: engaged, spendable_tnd: base.balance_tnd - engaged };
};
