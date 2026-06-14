// Multi-document model (F-docs Commit 2) — client mirror of the server's per-category
// caps (apps/api lib/user-documents.ts CATEGORY_CAPS, Kais's ruling): cin = 2 SEMANTIC
// slots (1=recto, 2=verso), rne ≤ 2, documents complémentaires ≤ 10, bank ≤ 1. The
// mirror is inline-UX only (C5/F1 pattern) — the server stays the authority (409/400).
export const DOCUMENT_CAPS = {
  cin: 2,
  rne: 2,
  complementaire: 10,
  bank: 1,
} as const;

export type ProfileDocumentCategory = keyof typeof DOCUMENT_CAPS;

// Mirrors the server's 5 MB multipart limit + pdf/jpeg/png allow-list.
export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;
export const DOCUMENT_ACCEPT = '.pdf,.jpg,.jpeg,.png';
export const DOCUMENT_FORMATS_COPY = 'Formats acceptés : PDF, JPG, JPEG, PNG (Max 5 MB)';
export const DOCUMENT_TOO_LARGE_ERROR = 'Fichier trop volumineux (max 5 MB)';

/** cin slots are semantic — 1=recto, 2=verso (server rejects a position-less cin upload). */
export const CIN_SLOT_LABELS: Record<number, string> = { 1: 'Recto', 2: 'Verso' };
