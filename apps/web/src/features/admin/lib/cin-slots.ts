import type { AdminDocumentView } from '@/features/admin/services/admin-user.service';

// CIN is stored as two SEMANTIC positions (the server contract): 1 = recto, 2 = verso. The admin
// review renders a fixed two-slot view so a missing side is visible, and maps each slot to its
// document BY POSITION — never by array order, which would silently swap recto/verso.
export const CIN_SLOTS: ReadonlyArray<{ position: number; label: string }> = [
  { position: 1, label: 'Recto' },
  { position: 2, label: 'Verso' },
];

export interface CinSlot {
  position: number;
  label: string;
  doc: AdminDocumentView | undefined;
}

/** Map the two CIN slots (recto=1, verso=2) to their documents by position, in slot order. */
export const cinSlots = (docs: AdminDocumentView[]): CinSlot[] =>
  CIN_SLOTS.map(({ position, label }) => ({
    position,
    label,
    doc: docs.find((d) => d.position === position),
  }));
