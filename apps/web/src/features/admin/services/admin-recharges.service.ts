import { apiClient } from '@/lib/api-client';

// Admin recharge moderation over REST — the manual-payment confirmation queue, repointed off the dead
// Supabase `recharges`/admin_profiles reads onto the EXISTING new-engine API (GET /api/admin/recharges
// + POST :id/confirm | :id/reject). apiClient prepends BASE='/api', so paths are WITHOUT the /api
// prefix; every route is [requireAuth, requireAdmin] server-side. Methods throw ApiError on failure.
//
// New-engine status model is pending → confirmed | rejected (the legacy completed/failed/cancelled
// quartet is gone; confirm CREDITS the derived balance, reject carries a reason). Fields the existing
// endpoint does NOT expose are FLAGGED, not faked: payment_method (not modelled), the confirming
// admin's NAME (only confirmed_by id; admins aren't in the moderation user list), and the
// manual-create flow + advertiser picker (no admin create-recharge endpoint exists — advertisers
// self-initiate top-ups via POST /api/wallet). Advertiser business_name/email are enriched from
// GET /api/admin/users?status=approved (see the hook), not from this view.

export type AdminRechargeStatus = 'pending' | 'confirmed' | 'rejected';

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
}

/**
 * CF-M2 — how the review modal shows the justificatif: images render INLINE next to the amount +
 * FCT reference; a PDF opens in its own tab (browsers own PDF rendering — no inline viewer here).
 */
export type DocumentDisplayMode = 'image' | 'pdf';

export const documentDisplayMode = (mime: string | null): DocumentDisplayMode =>
  mime !== null && mime.startsWith('image/') ? 'image' : 'pdf';

export interface RechargeStats {
  total_recharges: number;
  pending_count: number;
  confirmed_count: number;
  rejected_count: number;
  total_amount: number;
  pending_amount: number;
  confirmed_amount: number;
}

// Counters for the stat cards, DERIVED client-side from the full list (the endpoint returns every
// row when unfiltered, so this mirrors the old Supabase select-then-reduce — no stats endpoint needed).
export function computeRechargeStats(rows: AdminRecharge[]): RechargeStats {
  const sumOf = (s: AdminRechargeStatus) =>
    rows.filter((r) => r.status === s).reduce((acc, r) => acc + r.amount_tnd, 0);
  return {
    total_recharges: rows.length,
    pending_count: rows.filter((r) => r.status === 'pending').length,
    confirmed_count: rows.filter((r) => r.status === 'confirmed').length,
    rejected_count: rows.filter((r) => r.status === 'rejected').length,
    total_amount: rows.reduce((acc, r) => acc + r.amount_tnd, 0),
    pending_amount: sumOf('pending'),
    confirmed_amount: sumOf('confirmed'),
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

  formatAmount(amount: number): string {
    return new Intl.NumberFormat('fr-TN', {
      style: 'currency',
      currency: 'TND',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  },
};
