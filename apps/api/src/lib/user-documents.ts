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

// The legacy document-presence shape consumed by GET /api/me (the user onboarding indicator) and
// the admin moderation presence map. CIN is the only multi-face category: it counts COMPLETE only
// when BOTH semantic slots are on file — recto (position 1) AND verso (position 2) (Kais N5).
// registration (rne) and bank are present-if-any-row. Both surfaces share this helper so the
// "both faces" rule cannot drift between them.
export interface DocumentPresence {
  registration: boolean;
  cin: boolean;
  bank: boolean;
}

const CIN_REQUIRED_POSITIONS = [1, 2] as const;

export const documentPresence = (
  rows: { category: DocumentCategory; position: number }[],
): DocumentPresence => ({
  registration: rows.some((r) => r.category === 'rne'),
  cin: CIN_REQUIRED_POSITIONS.every((pos) =>
    rows.some((r) => r.category === 'cin' && r.position === pos),
  ),
  bank: rows.some((r) => r.category === 'bank'),
});

// A storage key in the new `<category>/<userId>/<rowId>` format is OWNED by its row and safe
// to delete with it. Legacy backfilled keys (`<type>/<userId>`) are NOT — the frozen users
// columns still reference those objects, and the ruling is that they never move or vanish.
export const isRowOwnedKey = (row: UserDocument): boolean =>
  row.storageKey === `${row.category}/${row.userId}/${row.id}`;
