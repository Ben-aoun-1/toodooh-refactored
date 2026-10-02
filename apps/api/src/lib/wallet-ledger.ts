import { and, desc, eq, inArray, isNotNull, or } from 'drizzle-orm';

import { db } from '../db/client.js';
import { campaignReconciliation, campaigns, recharges, walletAdjustments } from '../db/schema.js';

import { ENGAGED_CAMPAIGN_STATUSES, walletSpendable } from './recharges.js';

// FIX2 — the COMPLETE advertiser money ledger, SERVED (the web renders it verbatim; the old
// composeLedger derivation retires — the GREEN1 double-home dies here). Four row classes, each a
// SIGNED amount so Σ reconciles by arithmetic alone:
//   recharge    +  confirmed top-ups, dated at confirmation;
//   engagement  −  confirmed-but-unsettled campaigns at GROSS requested budget, dated at
//                  submission (the confirm click) — informational: the balance only moves at
//                  settlement, which is exactly why spendable ≠ total while any row of this
//                  class exists;
//   settlement  −  campaign_reconciliation NET spend (budget − refund, the ratified E6/FCT-R1
//                  netting — refunds are never split out), dated at reconciliation;
//   adjustment  ±  admin solde corrections, dated at creation, reason carried.
// Linkage: an engagement row and its later settlement row carry the SAME campaign_id and label,
// and the engagement row DISAPPEARS the moment the settlement row exists (the shared engaged-set
// predicate guarantees it).
//
// Invariants (pinned): total ≡ Σ(recharge) + Σ(settlement) + Σ(adjustment) — settlement rows are
// already negative; spendable ≡ total + Σ(engagement).

// LEDG-1 (operator, 2026-10-02) — « Engagé » NEVER disappears: every confirmed campaign keeps its
// −budget row from confirmation on, settled or not (ruling 3A: an ended-but-unsettled campaign shows
// it too). Settlement no longer REPLACES it with a net « Réglé » debit; it ADDS a « Remboursé »
// credit = requested budget − spend (the part of the engagement that was not spent), only when > 0.
// So Engagé + Remboursé ≡ −spend for a settled campaign, and the wallet maths are unchanged:
//   spendable ≡ Σ(all rows) − Σ(budgets of ended-unsettled campaigns)   (limbo: engaged on screen,
//   not yet deducted — it reconciles the moment the campaign settles).
// Supersedes FIX2's « settlement REPLACES engagement » row model (display only; data untouched).
export type WalletTransactionType = 'recharge' | 'engagement' | 'refund' | 'adjustment';

export interface WalletTransactionRow {
  id: string;
  type: WalletTransactionType;
  /** Display designation: campaign name for engagement/settlement, fixed labels otherwise. */
  label: string;
  /** SIGNED TND HT: recharges +, engagements −, refunds +, adjustments ±. */
  amount_tnd: number;
  /** ISO timestamp the row is dated and sorted by. */
  date: string;
  /** The linkage key between an engagement and its refund; null for recharges/adjustments. */
  campaign_id: string | null;
  /** Recharge payment method or adjustment reason; null otherwise. */
  detail: string | null;
}

export interface WalletLedger {
  transactions: WalletTransactionRow[];
  solde: {
    total_tnd: number;
    engaged_tnd: number;
    spendable_tnd: number;
    currency: 'TND';
  };
}

export const RECHARGE_LABEL = 'Rechargement wallet';
export const ADJUSTMENT_LABEL = 'Ajustement de solde';

const iso = (d: Date | null, fallback: Date): string => (d ?? fallback).toISOString();
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/**
 * What the campaign took at confirmation: its requested budget (boosts fold into it). A legacy row
 * with no budget falls back to its settled spend, so it never shows a refund it cannot justify.
 */
const engagedAmount = (c: { requestedBudget: string | null; spendTnd: string | null }): number =>
  c.requestedBudget !== null ? Number(c.requestedBudget) : Number(c.spendTnd ?? 0);

/** The complete ledger + the solde block, newest first — ONE call for the Mes finances page. */
export const walletLedger = async (advertiserId: string): Promise<WalletLedger> => {
  const spendable = await walletSpendable(advertiserId);

  const creditRows = await db
    .select()
    .from(recharges)
    .where(and(eq(recharges.advertiserId, advertiserId), eq(recharges.status, 'confirmed')))
    .orderBy(desc(recharges.createdAt));

  // Every campaign that ever took money: a live confirmed status, OR already settled.
  const campaignRows = await db
    .select({
      id: campaigns.id,
      name: campaigns.name,
      requestedBudget: campaigns.requestedBudget,
      submittedAt: campaigns.submittedAt,
      createdAt: campaigns.createdAt,
      spendTnd: campaignReconciliation.spendTnd,
      reconciliationId: campaignReconciliation.id,
      reconciledAt: campaignReconciliation.reconciledAt,
    })
    .from(campaigns)
    .leftJoin(campaignReconciliation, eq(campaignReconciliation.campaignId, campaigns.id))
    .where(
      and(
        eq(campaigns.advertiserId, advertiserId),
        or(
          inArray(campaigns.status, [...ENGAGED_CAMPAIGN_STATUSES]),
          isNotNull(campaignReconciliation.id),
        ),
      ),
    );

  const adjustmentRows = await db
    .select()
    .from(walletAdjustments)
    .where(eq(walletAdjustments.advertiserId, advertiserId));

  const transactions: WalletTransactionRow[] = [
    ...creditRows.map((r) => ({
      id: `recharge-${r.id}`,
      type: 'recharge' as const,
      label: RECHARGE_LABEL,
      amount_tnd: Number(r.amountTnd),
      date: iso(r.confirmedAt, r.createdAt),
      campaign_id: null,
      detail: r.method === 'bon_de_commande' ? 'Bon de commande' : 'Virement bancaire',
    })),
    // A legacy campaign that never carried a budget (and never settled) took nothing: no 0 row.
    ...campaignRows
      .filter((c) => engagedAmount(c) > 0)
      .map((c) => ({
        id: `engagement-${c.id}`,
        type: 'engagement' as const,
        label: c.name || 'Campagne',
        amount_tnd: -engagedAmount(c),
        date: iso(c.submittedAt, c.createdAt),
        campaign_id: c.id,
        detail: null,
      })),
    ...campaignRows.flatMap((c) => {
      if (c.reconciliationId === null || c.reconciledAt === null) return [];
      const refund = round4(engagedAmount(c) - Number(c.spendTnd ?? 0));
      if (refund <= 0) return [];
      return [
        {
          id: `refund-${c.reconciliationId}`,
          type: 'refund' as const,
          label: c.name || 'Campagne',
          amount_tnd: refund,
          date: c.reconciledAt.toISOString(),
          campaign_id: c.id,
          detail: null,
        },
      ];
    }),
    ...adjustmentRows.map((a) => ({
      id: `adjustment-${a.id}`,
      type: 'adjustment' as const,
      label: ADJUSTMENT_LABEL,
      amount_tnd: Number(a.amountTnd),
      date: a.createdAt.toISOString(),
      campaign_id: null,
      detail: a.reason,
    })),
  ].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  return {
    transactions,
    solde: {
      total_tnd: spendable.balance_tnd,
      engaged_tnd: spendable.engaged_tnd,
      spendable_tnd: spendable.spendable_tnd,
      currency: 'TND',
    },
  };
};
