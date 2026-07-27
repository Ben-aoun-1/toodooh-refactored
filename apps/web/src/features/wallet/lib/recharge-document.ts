import type { RechargeRow } from '@/features/wallet/services/wallet.service';

/**
 * CF-M2 — the justificatif de virement rules, pure and testable.
 *
 * FCT1 retired the create-then-attach two-call seam (createRechargeWithDocument): a virement
 * demande is now created WITH its mandatory justificatif in ONE multipart call
 * (walletService.createVirement). What stays here: the accepted-type/size mirrors and the
 * MyInvoices per-row affordances (attach-later still exists for LEGACY pending rows and as the
 * replace path on a pending virement).
 */

/** Accepted justificatif types — mirrors the server gate (PDF/JPEG/PNG, byte-sniffed there). */
export const JUSTIFICATIF_ACCEPT = 'application/pdf,image/jpeg,image/png';
/** 10 Mo — mirrors the server's MAX_JUSTIFICATIF_BYTES (a client pre-check, never the authority). */
export const MAX_JUSTIFICATIF_BYTES = 10 * 1024 * 1024;

export const isJustificatifTooLarge = (file: Pick<File, 'size'>): boolean =>
  file.size > MAX_JUSTIFICATIF_BYTES;

export interface JustificatifAffordances {
  /** Attach/replace is PENDING-only (the API 409s a decided recharge). */
  canAttach: boolean;
  attachLabel: 'Ajouter le justificatif' | 'Remplacer le justificatif';
  /** View rides the presigned URL — any status, as long as a document exists. */
  canView: boolean;
}

/** The per-row affordance matrix for the advertiser factures list (MyInvoices). */
export const justificatifAffordances = (row: {
  statut: RechargeRow['status'];
  has_document: boolean;
}): JustificatifAffordances => ({
  canAttach: row.statut === 'pending',
  attachLabel: row.has_document ? 'Remplacer le justificatif' : 'Ajouter le justificatif',
  canView: row.has_document,
});
