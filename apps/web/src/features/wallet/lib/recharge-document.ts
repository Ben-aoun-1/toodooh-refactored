import type { RechargeRow } from '@/features/wallet/services/wallet.service';

/**
 * CF-M2 — the justificatif de virement seam, pure and testable.
 *
 * The recharge request and its document are TWO wire calls (the POST stays {amount} — CF-M1/U1):
 * the recharge is created first, the document is attached after. A document failure must NEVER
 * lose the created recharge — the caller gets the created row back with `documentError` set and
 * the row keeps its « Ajouter le justificatif » affordance for a retry (MyInvoices).
 */

/** Accepted justificatif types — mirrors the server gate (PDF/JPEG/PNG, byte-sniffed there). */
export const JUSTIFICATIF_ACCEPT = 'application/pdf,image/jpeg,image/png';
/** 10 Mo — mirrors the server's MAX_JUSTIFICATIF_BYTES (a client pre-check, never the authority). */
export const MAX_JUSTIFICATIF_BYTES = 10 * 1024 * 1024;

export const isJustificatifTooLarge = (file: Pick<File, 'size'>): boolean =>
  file.size > MAX_JUSTIFICATIF_BYTES;

export interface CreateRechargeWithDocumentResult {
  recharge: RechargeRow;
  /** True when the recharge was created but the document upload failed (toast + retry later). */
  documentError: boolean;
}

interface CreateRechargeDeps {
  createRecharge: (amountTnd: number) => Promise<RechargeRow>;
  uploadJustificatif: (id: string, file: File) => Promise<RechargeRow>;
}

/**
 * Create the recharge, then attach the optional justificatif. A create failure throws (nothing
 * exists yet); a document failure resolves with the CREATED recharge + documentError so the UI
 * can toast and keep the row (the document is re-attachable while pending).
 */
export const createRechargeWithDocument = async (
  deps: CreateRechargeDeps,
  amountTnd: number,
  file: File | null,
): Promise<CreateRechargeWithDocumentResult> => {
  const recharge = await deps.createRecharge(amountTnd);
  if (file === null) return { recharge, documentError: false };
  try {
    const updated = await deps.uploadJustificatif(recharge.id, file);
    return { recharge: updated, documentError: false };
  } catch {
    return { recharge, documentError: true };
  }
};

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
