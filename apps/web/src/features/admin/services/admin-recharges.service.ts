import type { RechargeMethod } from '@/features/wallet/lib/recharge-methods';
import { apiClient } from '@/lib/api-client';

// Admin recharge moderation over REST — the manual-payment confirmation queue (GET
// /api/admin/recharges + POST :id/confirm | :id/reject). apiClient prepends BASE='/api', so paths
// are WITHOUT the /api prefix; every route is [requireAuth, requireAdmin] server-side. Methods
// throw ApiError on failure.
//
// FCT1 — the per-method model: virement runs pending («En attente de réception») → confirmed
// («Créditée») | rejected («Annulée»); a bon reaches the queue only as 'bon_returned' («Bon
// retourné signé») — 'bon_issued' rows are SERVER-EXCLUDED (screencaster-only) and never appear
// here. Legacy rows (method null) keep the as-found pending/confirmed/rejected labels. Confirm
// CREDITS the derived balance AT VALIDATION; reject carries a required reason. Advertiser
// business_name/email are enriched from GET /api/admin/users?status=approved (see the hook).

export type AdminRechargeStatus = 'pending' | 'confirmed' | 'rejected' | 'bon_returned';

// The admin projection (lib/recharges.adminRechargeView): the advertiser-facing fields + advertiser_id
// + confirmed_by (audit). amount is a number (the numeric column's exact value).
export interface AdminRecharge {
  id: string;
  advertiser_id: string;
  amount_tnd: number;
  status: AdminRechargeStatus;
  reference: string;
  reject_reason: string | null;
  confirmed_at: string | null;
  confirmed_by: string | null;
  created_at: string;
  updated_at: string;
  /** CF-M2 — the justificatif de virement: presence badges the queue, mime picks the render mode. */
  has_document: boolean;
  document_uploaded_at: string | null;
  document_mime: string | null;
  /** FCT1 — null = legacy row (renders as-found: « — » type, as-found status labels). */
  method: RechargeMethod | null;
  has_bon: boolean;
  has_signed_bon: boolean;
  signed_bon_mime: string | null;
  signed_bon_deposited_at: string | null;
  cancelled_at: string | null;
}

/**
 * CF-M2 — how the review modal shows the justificatif: images render INLINE next to the amount +
 * FCT reference; a PDF opens in its own tab (browsers own PDF rendering — no inline viewer here).
 */
// FCT2 — one audited solde adjustment (the admin wire: lib/wallet-adjustments.adminAdjustmentView).
export interface AdminWalletAdjustment {
  id: string;
  advertiser_id: string;
  admin_id: string;
  amount_tnd: number;
  reason: string;
  created_at: string;
}

export type DocumentDisplayMode = 'image' | 'pdf';

export const documentDisplayMode = (mime: string | null): DocumentDisplayMode =>
  mime !== null && mime.startsWith('image/') ? 'image' : 'pdf';

export interface RechargeStats {
  total_recharges: number;
  pending_count: number;
  confirmed_count: number;
  rejected_count: number;
  /** ADM-RCH1 — Σ of every row that is NOT rejected (« Annulée » money never entered the platform). */
  total_amount: number;
  pending_amount: number;
  confirmed_amount: number;
  /** ADM-RCH1 — the rejected (« Annulée ») money, kept countable but OUT of total_amount. */
  rejected_amount: number;
}

// Counters for the stat cards, DERIVED client-side from the full list (the endpoint returns every
// row when unfiltered, so this mirrors the old Supabase select-then-reduce — no stats endpoint
// needed). FCT1: « En attente » counts the ACTIONABLE rows — pending AND bon_returned (a returned
// signed bon awaits the same Valider).
// ADM-RCH1 (Mejri/Kais QA) — « Montant Total » summed EVERY row, rejected ones included, so an
// admin who cancelled a 4 000 TND recharge still saw it in the total. A rejected (« Annulée »)
// recharge never credited anything: it is excluded from total_amount and carried separately as
// rejected_amount (still countable, never added).
export function computeRechargeStats(rows: AdminRecharge[]): RechargeStats {
  const awaiting = (r: AdminRecharge) => r.status === 'pending' || r.status === 'bon_returned';
  const rejected = (r: AdminRecharge) => r.status === 'rejected';
  const sum = (list: AdminRecharge[]) => list.reduce((acc, r) => acc + r.amount_tnd, 0);
  return {
    total_recharges: rows.length,
    pending_count: rows.filter(awaiting).length,
    confirmed_count: rows.filter((r) => r.status === 'confirmed').length,
    rejected_count: rows.filter(rejected).length,
    total_amount: sum(rows.filter((r) => !rejected(r))),
    pending_amount: sum(rows.filter(awaiting)),
    confirmed_amount: sum(rows.filter((r) => r.status === 'confirmed')),
    rejected_amount: sum(rows.filter(rejected)),
  };
}

export const adminRechargesService = {
  // The moderation queue (newest first, server-ordered); optional status filter. Backend sends the
  // array directly (not wrapped), so the typed return is AdminRecharge[].
  async list(status?: AdminRechargeStatus): Promise<AdminRecharge[]> {
    const qs = status ? `?status=${status}` : '';
    return apiClient.get<AdminRecharge[]>(`/admin/recharges${qs}`);
  },

  // pending → confirmed; credits the advertiser's derived balance (idempotent — a re-confirm 409s).
  async confirm(id: string): Promise<AdminRecharge> {
    return apiClient.post<AdminRecharge>(`/admin/recharges/${id}/confirm`);
  },

  // pending → rejected; a reason is REQUIRED (surfaced to the advertiser as reject_reason).
  async reject(id: string, reason: string): Promise<AdminRecharge> {
    return apiClient.post<AdminRecharge>(`/admin/recharges/${id}/reject`, { reason });
  },

  // CF-M2 — short-TTL (300s) presigned view URL of a recharge's justificatif; 404 when doc-less.
  async documentUrl(id: string): Promise<{ url: string }> {
    return apiClient.get<{ url: string }>(`/admin/recharges/${id}/document-url`);
  },

  // FCT1 — the GENERATED bon PDF (cross-check the signed copy against it); same presign posture.
  async bonUrl(id: string): Promise<{ url: string }> {
    return apiClient.get<{ url: string }>(`/admin/recharges/${id}/bon-url`);
  },

  // FCT1 — the DEPOSITED signed bon; 404 until the screencaster deposits it.
  async signedBonUrl(id: string): Promise<{ url: string }> {
    return apiClient.get<{ url: string }>(`/admin/recharges/${id}/signed-bon-url`);
  },

  // FCT2 (US-FCT-9) — the SIGNED, audited solde adjustment (reason REQUIRED server-side too).
  async adjustWallet(
    advertiserId: string,
    amountTnd: number,
    reason: string,
  ): Promise<AdminWalletAdjustment> {
    return apiClient.post<AdminWalletAdjustment>(
      `/admin/advertisers/${advertiserId}/wallet-adjustment`,
      { amount_tnd: amountTnd, reason },
    );
  },

  // FCT2 — the audit trail for one advertiser, newest first.
  async walletAdjustments(advertiserId: string): Promise<AdminWalletAdjustment[]> {
    return apiClient.get<AdminWalletAdjustment[]>(
      `/admin/advertisers/${advertiserId}/wallet-adjustments`,
    );
  },

  formatAmount(amount: number): string {
    return new Intl.NumberFormat('fr-TN', {
      style: 'currency',
      currency: 'TND',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  },
};
