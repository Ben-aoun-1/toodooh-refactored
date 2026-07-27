import type { CampaignView } from '@/features/campaigns/services/campaigns.api';
import type { AdjustmentRow, RechargeRow } from '@/features/wallet/services/wallet.service';

/**
 * The Mes finances ledger, pure composition from the LIVE endpoints. FCT2 — THREE row types:
 *   credits     — CONFIRMED recharges, dated at confirmation (when the money entered the balance);
 *   debits      — LAUNCHED campaigns (status active/completed), VISIBLE FROM AND DATED AT the
 *                 campaign's start day (US-FCT-14's visible view). The AMOUNT shows the reconciled
 *                 NET spend once settled, the engaged budget before. NOTE the deliberate
 *                 asymmetry: the BALANCE still moves only at reconciliation (the funded gates'
 *                 read-only posture is untouched) — the history anticipates, the money does not.
 *   adjustments — the admin solde corrections (US-FCT-9), SIGNED, dated at creation, reason shown.
 * Payment method: « Bon de commande » for bon-method credits, « Virement bancaire » otherwise.
 */
export interface LedgerTransaction {
  id: string;
  type: 'recharge' | 'expense' | 'adjustment';
  designation: string;
  /** SIGNED for adjustments; positive for recharges/expenses (the sign rides `type`). */
  amount: number;
  date: Date;
  paymentMethod?: string;
}

export const RECHARGE_DESIGNATION = 'Rechargement wallet';
export const RECHARGE_PAYMENT_METHOD = 'Virement bancaire';
export const ADJUSTMENT_DESIGNATION = 'Ajustement de solde';

/** A campaign debit is visible once the campaign LAUNCHED (reached its start day). */
const isLaunched = (c: CampaignView): boolean =>
  (c.status === 'active' || c.status === 'completed') && c.start_date !== null;

export const composeLedger = (
  recharges: readonly RechargeRow[],
  campaigns: readonly CampaignView[],
  adjustments: readonly AdjustmentRow[] = [],
): LedgerTransaction[] => {
  const lines: LedgerTransaction[] = [];
  for (const r of recharges) {
    if (r.status !== 'confirmed') continue;
    lines.push({
      id: `r-${r.id}`,
      type: 'recharge',
      designation: RECHARGE_DESIGNATION,
      amount: r.amount_tnd,
      date: new Date(r.confirmed_at ?? r.created_at),
      paymentMethod: r.method === 'bon_de_commande' ? 'Bon de commande' : RECHARGE_PAYMENT_METHOD,
    });
  }
  for (const c of campaigns) {
    if (!isLaunched(c)) continue;
    lines.push({
      id: `c-${c.id}`,
      type: 'expense',
      designation: c.name || 'Campagne',
      // The reconciled NET once settled; the engaged ask before (0 only for a budget-less draft
      // that somehow launched — renders honestly as 0, never NaN).
      amount: c.spend_tnd ?? c.requested_budget ?? 0,
      // Dated at the LAUNCH DAY (date-only string → UTC midnight, the formatDate convention).
      date: new Date(c.start_date ?? c.created_at),
    });
  }
  for (const a of adjustments) {
    lines.push({
      id: `a-${a.id}`,
      type: 'adjustment',
      designation: ADJUSTMENT_DESIGNATION,
      amount: a.amount_tnd,
      date: new Date(a.created_at),
      paymentMethod: a.reason,
    });
  }
  lines.sort((a, b) => b.date.getTime() - a.date.getTime());
  return lines;
};

/**
 * The MyInvoices « Récapitulatifs de commande » rows (FCT2 relabel — every recharge HAS a
 * récapitulatif; the real factures are the MONTHLY consolidated ones, listed separately).
 * Newest first, as served.
 */
export interface InvoiceRow {
  id: string;
  numero: string;
  montant: number;
  date_emission: string;
  statut: RechargeRow['status'];
  /** CF-M2 — drives the « Ajouter/Remplacer/Voir le justificatif » row affordances. */
  has_document: boolean;
}

export const invoiceRows = (recharges: readonly RechargeRow[]): InvoiceRow[] =>
  recharges.map((r) => ({
    id: r.id,
    numero: r.reference,
    montant: r.amount_tnd,
    date_emission: r.created_at,
    statut: r.status,
    has_document: r.has_document,
  }));

/** « Récapitulatif de commande — Juillet 2026 » (FCT2 relabel of the old facture designation). */
export const recapitulatifDesignation = (dateEmission: string): string => {
  const d = new Date(dateEmission);
  if (Number.isNaN(d.getTime())) return 'Récapitulatif de commande';
  const month = d.toLocaleDateString('fr-FR', { month: 'long' });
  return `Récapitulatif de commande — ${month.charAt(0).toUpperCase() + month.slice(1)} ${d.getFullYear()}`;
};

/** « Facture Juillet 2026 » — the MONTHLY consolidated invoice designation ('YYYY-MM' input). */
export const monthlyInvoiceDesignation = (month: string): string => {
  const d = new Date(`${month}-01T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return 'Facture';
  const label = d.toLocaleDateString('fr-FR', { month: 'long', timeZone: 'UTC' });
  return `Facture ${label.charAt(0).toUpperCase() + label.slice(1)} ${month.slice(0, 4)}`;
};
