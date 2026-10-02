import type { RechargeRow, WalletTransactionRow } from '@/features/wallet/services/wallet.service';

/**
 * FIX2 — the Mes finances ledger is SERVED (GET /api/wallet/transactions) and rendered VERBATIM.
 * The client-side composition over recharges + campaigns (`composeLedger`) is RETIRED with its
 * « the history anticipates, the money does not » asymmetry: engagements are now real served
 * rows (typed 'engagement', appearing at confirm), settlements are the ratified NET, and
 * Σ(rows) reconciles with the displayed solde by arithmetic alone — api-pinned. What remains
 * here is the pure VIEW mapping: wire row → badge/tone the table renders.
 */

/**
 * LEDG-1 (operator, 2026-10-02): « Engagé » is the money a campaign took at confirmation and never
 * disappears; « Remboursé » is what came back at settlement (served only when > 0). Ruling 5A: an
 * engagement is a real debit (red), a refund a credit (green).
 */
export type TransactionTone = 'credit' | 'debit';

export interface TransactionView {
  id: string;
  type: WalletTransactionRow['type'];
  designation: string;
  /** French row badge: « Engagé » for engagements, « Remboursé » for refunds. */
  badge: 'Engagé' | 'Remboursé' | null;
  /** SIGNED TND HT, exactly as served. */
  amountTnd: number;
  date: Date;
  /** The « Modes de paiement » column: recharge method / adjustment reason. */
  method: string;
  tone: TransactionTone;
}

/** The verbatim view: sign and type come FROM THE WIRE, never re-derived. */
export const transactionView = (row: WalletTransactionRow): TransactionView => ({
  id: row.id,
  type: row.type,
  designation: row.label,
  badge: row.type === 'engagement' ? 'Engagé' : row.type === 'refund' ? 'Remboursé' : null,
  amountTnd: row.amount_tnd,
  date: new Date(row.date),
  method: row.detail ?? '',
  tone: row.amount_tnd >= 0 ? 'credit' : 'debit',
});

/** LEDG-1 ruling 4A — the « Dernières transactions » filters, one per row type. */
export type LedgerFilter = 'all' | 'recharges' | 'engagements' | 'refunds' | 'adjustments';

export const LEDGER_FILTERS: readonly { key: LedgerFilter; label: string }[] = [
  { key: 'all', label: 'Tous' },
  { key: 'recharges', label: 'Recharges' },
  { key: 'engagements', label: 'Engagements' },
  { key: 'refunds', label: 'Remboursements' },
  { key: 'adjustments', label: 'Ajustements' },
];

const FILTER_TYPE: Record<Exclude<LedgerFilter, 'all'>, TransactionView['type']> = {
  recharges: 'recharge',
  engagements: 'engagement',
  refunds: 'refund',
  adjustments: 'adjustment',
};

export const matchesLedgerFilter = (view: TransactionView, filter: LedgerFilter): boolean =>
  filter === 'all' || view.type === FILTER_TYPE[filter];

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
