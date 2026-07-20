import type { CampaignView } from '@/features/campaigns/services/campaigns.api';
import type { RechargeRow } from '@/features/wallet/services/wallet.service';

/**
 * CF-M1 — pure composition of the MyRecharges ledger from the LIVE endpoints, replacing the
 * Supabase merge (completed recharges + budget×TVA guesses). The lines now reconcile EXACTLY with
 * GET /api/wallet/balance:
 *   credits — CONFIRMED recharges (what walletBalance sums as credited_tnd), dated at
 *             confirmation (the moment the money entered the balance);
 *   debits  — each campaign's RECONCILED net spend (spend_tnd, the same 1:1 reconciliation row
 *             walletBalance sums as debited_tnd), dated at reconciliation. A campaign with no
 *             reconciliation row yet has cost the wallet nothing and shows no line.
 * Payment method is « Virement bancaire » on every credit — bank transfer is the ONLY recharge
 * channel (operator ruling; no online gateway).
 */
export interface LedgerTransaction {
  id: string;
  type: 'recharge' | 'expense';
  designation: string;
  amount: number;
  date: Date;
  paymentMethod?: string;
}

export const RECHARGE_DESIGNATION = 'Rechargement wallet';
export const RECHARGE_PAYMENT_METHOD = 'Virement bancaire';

export const composeLedger = (
  recharges: readonly RechargeRow[],
  campaigns: readonly CampaignView[],
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
      paymentMethod: RECHARGE_PAYMENT_METHOD,
    });
  }
  for (const c of campaigns) {
    if (c.spend_tnd === null || c.spend_tnd === undefined) continue;
    lines.push({
      id: `c-${c.id}`,
      type: 'expense',
      designation: c.name || 'Campagne',
      amount: c.spend_tnd,
      date: new Date(c.reconciled_at ?? c.created_at),
    });
  }
  lines.sort((a, b) => b.date.getTime() - a.date.getTime());
  return lines;
};

/**
 * The MyInvoices rows — every recharge IS a facture (the FCT- reference is minted at creation and
 * the server PDF is downloadable immediately: it carries the bank coordinates the advertiser
 * wires to). Newest first, as served.
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

/** « Facture Juillet 2026 » — the designation MyInvoices renders (no per-facture description). */
export const invoiceDesignation = (dateEmission: string): string => {
  const d = new Date(dateEmission);
  if (Number.isNaN(d.getTime())) return 'Facture';
  const month = d.toLocaleDateString('fr-FR', { month: 'long' });
  return `Facture ${month.charAt(0).toUpperCase() + month.slice(1)} ${d.getFullYear()}`;
};
