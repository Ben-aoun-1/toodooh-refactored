import type { RechargeMethod, RechargeStatus } from '@/features/wallet/lib/recharge-methods';
import { apiClient } from '@/lib/api-client';

/**
 * The advertiser money surface, served by `apps/api` (routes/recharges.ts). FCT1 (recharge
 * parcours v2) replaced the generic POST with TWO method-explicit creations:
 *   POST /api/recharges/virement?amount= (multipart) → 201 'pending' + VIR- reference — the
 *                                             justificatif file is MANDATORY at creation
 *   POST /api/recharges/bon {amount}        → 201 'bon_issued' + BC- reference — the server
 *                                             renders + STORES the bon de commande PDF
 *   POST /api/recharges/:id/signed-bon      → deposit the SIGNED bon → 'bon_returned'
 *   GET  /api/recharges/:id/bon             → the stored bon PDF (streamed, owner-scoped)
 *   GET  /api/recharges/bank-coordinates    → Toodooh's RIB/IBAN/BIC/domiciliation («Pour info»)
 *   GET  /api/recharges/mine[?status=]      → the caller's recharges, newest first
 *   GET  /api/wallet/balance                → the DERIVED balance (credited − debited)
 *   GET  /api/recharges/:id/facture         → the SERVER-rendered facture PDF — streamed
 *
 * Session-cookie scoped — no userId argument; wire is snake_case. An admin confirms receipt
 * (virement) or the returned signed bon to credit the balance — credit AT VALIDATION, never before.
 */

export type { RechargeMethod, RechargeStatus };

export interface RechargeRow {
  id: string;
  amount_tnd: number;
  status: RechargeStatus;
  /** VIR-/BC- + 8 alphanumerics for v2 rows; legacy rows keep their FCT- reference. */
  reference: string;
  reject_reason: string | null;
  confirmed_at: string | null;
  created_at: string;
  updated_at: string;
  /** CF-M2 — whether a justificatif de virement is attached (the key itself stays server-side). */
  has_document: boolean;
  document_uploaded_at: string | null;
  /** FCT1 — null = legacy row created before the method split (renders as-found). */
  method: RechargeMethod | null;
  has_bon: boolean;
  has_signed_bon: boolean;
  signed_bon_deposited_at: string | null;
  cancelled_at: string | null;
}

export interface WalletBalance {
  balance_tnd: number;
  credited_tnd: number;
  debited_tnd: number;
  currency: 'TND';
}

export interface BankCoordinatesWire {
  rib: string;
  iban: string;
  bic: string;
  domiciliation: string;
}

/** The facture download filename — mirrors the server's content-disposition. */
export const factureFilename = (reference: string): string => `facture-${reference}.pdf`;

/** The bon download filename — mirrors GET /:id/bon's content-disposition. */
export const bonFilename = (reference: string): string => `bon-commande-${reference}.pdf`;

export const walletService = {
  /** The caller's derived wallet balance (confirmed credits − reconciled campaign spend). */
  getBalance(): Promise<WalletBalance> {
    return apiClient.get<WalletBalance>('/wallet/balance');
  },

  /** The caller's recharges, newest first (every row carries its reference). */
  listMyRecharges(): Promise<RechargeRow[]> {
    return apiClient.get<RechargeRow[]>('/recharges/mine');
  },

  /**
   * FCT1 — create a virement demande WITH its mandatory justificatif (one multipart call; the
   * amount rides the querystring, the body is file-only — the house fields:0 pattern).
   */
  createVirement(amountTnd: number, file: File): Promise<RechargeRow> {
    const form = new FormData();
    form.append('file', file);
    return apiClient.postForm<RechargeRow>(`/recharges/virement?amount=${amountTnd}`, form);
  },

  /** FCT1 — generate a bon de commande: the server renders + stores the PDF, row lands Bon émis. */
  createBon(amountTnd: number): Promise<RechargeRow> {
    return apiClient.post<RechargeRow>('/recharges/bon', { amount: amountTnd });
  },

  /** FCT1 — the stored bon de commande PDF (byte-stable — the paper the client signs). */
  downloadBon(id: string): Promise<Blob> {
    return apiClient.getBlob(`/recharges/${id}/bon`);
  },

  /** FCT1 — deposit the SIGNED bon (PDF/JPEG/PNG ≤ 10 Mo) → « Bon retourné signé ». */
  uploadSignedBon(id: string, file: File): Promise<RechargeRow> {
    const form = new FormData();
    form.append('file', file);
    return apiClient.postForm<RechargeRow>(`/recharges/${id}/signed-bon`, form);
  },

  /** FCT1 — Toodooh's own bank coordinates for the « Pour info » block ('—' = not provisioned). */
  getBankCoordinates(): Promise<BankCoordinatesWire> {
    return apiClient.get<BankCoordinatesWire>('/recharges/bank-coordinates');
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
