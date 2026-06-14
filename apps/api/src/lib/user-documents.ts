import type { UserDocument } from '../db/schema.js';

// Multi-document model helpers (F-docs Commit 1) shared by the self-serve routes
// (profile-documents.ts) and the admin review surface (admin.ts).

// Per-category caps (Kais's ruling): cin = 2 SEMANTIC slots (1=recto, 2=verso),
// rne ≤ 2, documents complémentaires ≤ 10, bank ≤ 1.
export const CATEGORY_CAPS = {
  cin: 2,
  rne: 2,
  complementaire: 10,
  bank: 1,
} as const;

export type DocumentCategory = keyof typeof CATEGORY_CAPS;

export const docView = (row: UserDocument) => ({
  id: row.id,
  category: row.category,
  position: row.position,
  original_filename: row.originalFilename,
  mime_type: row.mimeType,
  size_bytes: row.sizeBytes,
  uploaded_at: row.uploadedAt,
});

export type DocumentView = ReturnType<typeof docView>;

export const groupedDocuments = (rows: UserDocument[]) => {
  const grouped: Record<DocumentCategory, DocumentView[]> = {
    cin: [],
    rne: [],
    complementaire: [],
    bank: [],
  };
  for (const row of rows) grouped[row.category].push(docView(row));
  return grouped;
};

// A storage key in the new `<category>/<userId>/<rowId>` format is OWNED by its row and safe
// to delete with it. Legacy backfilled keys (`<type>/<userId>`) are NOT — the frozen users
// columns still reference those objects, and the ruling is that they never move or vanish.
export const isRowOwnedKey = (row: UserDocument): boolean =>
  row.storageKey === `${row.category}/${row.userId}/${row.id}`;
