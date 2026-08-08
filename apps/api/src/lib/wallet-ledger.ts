import { and, desc, eq } from 'drizzle-orm';

import { db } from '../db/client.js';
import { campaignReconciliation, campaigns, recharges, walletAdjustments } from '../db/schema.js';

import { engagedCampaignConditions, walletSpendable } from './recharges.js';

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

export type WalletTransactionType = 'recharge' | 'engagement' | 'settlement' | 'adjustment';

export interface WalletTransactionRow {
  id: string;
  type: WalletTransactionType;
  /** Display designation: campaign name for engagement/settlement, fixed labels otherwise. */
  label: string;
  /** SIGNED TND HT: recharges +, engagements −, settlements − (0 for a fully refunded one). */
  amount_tnd: number;
  /** ISO timestamp the row is dated and sorted by. */
  date: string;
  /** The linkage key between an engagement and its settlement; null for recharges/adjustments. */
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

/** The complete ledger + the solde block, newest first — ONE call for the Mes finances page. */
export const walletLedger = async (advertiserId: string): Promise<WalletLedger> => {
  const spendable = await walletSpendable(advertiserId);

  const creditRows = await db
    .select()
    .from(recharges)
    .where(and(eq(recharges.advertiserId, advertiserId), eq(recharges.status, 'confirmed')))
    .orderBy(desc(recharges.createdAt));

  const engagedRows = await db
    .select({
      id: campaigns.id,
      name: campaigns.name,
      requestedBudget: campaigns.requestedBudget,
      submittedAt: campaigns.submittedAt,
      createdAt: campaigns.createdAt,
    })
    .from(campaigns)
    .leftJoin(campaignReconciliation, eq(campaignReconciliation.campaignId, campaigns.id))
    .where(and(...engagedCampaignConditions(advertiserId)));

  const settledRows = await db
    .select({
      id: campaignReconciliation.id,
      campaignId: campaignReconciliation.campaignId,
      name: campaigns.name,
      spendTnd: campaignReconciliation.spendTnd,
      reconciledAt: campaignReconciliation.reconciledAt,
    })
    .from(campaignReconciliation)
    .innerJoin(campaigns, eq(campaignReconciliation.campaignId, campaigns.id))
    .where(eq(campaigns.advertiserId, advertiserId));

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
    ...engagedRows.map((c) => ({
      id: `engagement-${c.id}`,
      type: 'engagement' as const,
      label: c.name || 'Campagne',
      amount_tnd: -Number(c.requestedBudget ?? 0),
      date: iso(c.submittedAt, c.createdAt),
      campaign_id: c.id,
      detail: null,
    })),
    ...settledRows.map((s) => ({
      id: `settlement-${s.id}`,
      type: 'settlement' as const,
      label: s.name || 'Campagne',
      amount_tnd: -Number(s.spendTnd),
      date: s.reconciledAt.toISOString(),
      campaign_id: s.campaignId,
      detail: null,
    })),
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
