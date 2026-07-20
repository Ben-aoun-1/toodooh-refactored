import { apiClient } from '@/lib/api-client';

/**
 * CF-M1 — the advertiser money surface, served by `apps/api` (routes/recharges.ts):
 *   POST /api/recharges {amount}            → 201 PENDING recharge + its FCT- reference
 *   GET  /api/recharges/mine[?status=]      → the caller's recharges, newest first
 *   GET  /api/wallet/balance                → the DERIVED balance (credited − debited)
 *   GET  /api/recharges/:id/facture         → the SERVER-rendered facture PDF (pdfkit, bank
 *                                             details from env) — streamed, owner-scoped
 *
 * This replaces the disabled Supabase paths (balance.service RPC, recharges table inserts, the
 * client-side jsPDF facture). Session-cookie scoped — no userId argument; wire is snake_case.
 * The recharge flow is BANK TRANSFER only (operator ruling): the facture carries the bank
 * coordinates the advertiser wires to, and an admin confirms receipt to credit the balance.
 */

export type RechargeStatus = 'pending' | 'confirmed' | 'rejected';

export interface RechargeRow {
  id: string;
  amount_tnd: number;
  status: RechargeStatus;
  /** The human invoice reference (FCT-XXXXXXXX), derived server-side from the recharge id. */
  reference: string;
  reject_reason: string | null;
  confirmed_at: string | null;
  created_at: string;
  updated_at: string;
  /** CF-M2 — whether a justificatif de virement is attached (the key itself stays server-side). */
  has_document: boolean;
  document_uploaded_at: string | null;
}

export interface WalletBalance {
  balance_tnd: number;
  credited_tnd: number;
  debited_tnd: number;
  currency: 'TND';
}

/** The facture download filename — mirrors the server's content-disposition. */
export const factureFilename = (reference: string): string => `facture-${reference}.pdf`;

export const walletService = {
  /** The caller's derived wallet balance (confirmed credits − reconciled campaign spend). */
  getBalance(): Promise<WalletBalance> {
    return apiClient.get<WalletBalance>('/wallet/balance');
  },

  /** The caller's recharges, newest first (every row carries its FCT- facture reference). */
  listMyRecharges(): Promise<RechargeRow[]> {
    return apiClient.get<RechargeRow[]>('/recharges/mine');
  },

  /** Request a top-up: creates a PENDING recharge awaiting admin confirmation of the transfer. */
  createRecharge(amountTnd: number): Promise<RechargeRow> {
    return apiClient.post<RechargeRow>('/recharges', { amount: amountTnd });
  },

  /** The server-rendered facture PDF (the REAL invoice, bank-details block included). */
  downloadFacture(id: string): Promise<Blob> {
    return apiClient.getBlob(`/recharges/${id}/facture`);
  },

  /**
   * CF-M2 — attach (or replace) the justificatif de virement on a PENDING recharge
   * (POST /api/recharges/:id/document — multipart, PDF/JPEG/PNG ≤ 10 Mo, byte-sniffed server-side).
   */
  uploadJustificatif(id: string, file: File): Promise<RechargeRow> {
    const form = new FormData();
    form.append('file', file);
    return apiClient.postForm<RechargeRow>(`/recharges/${id}/document`, form);
  },

  /** CF-M2 — short-TTL presigned view URL of the caller's justificatif (owner-scoped, 404 doc-less). */
  getJustificatifUrl(id: string): Promise<{ url: string }> {
    return apiClient.get<{ url: string }>(`/recharges/${id}/document-url`);
  },
};
