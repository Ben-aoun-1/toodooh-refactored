import { describe, expect, it } from 'vitest';

import type { AdminDocumentView } from '@/features/admin/services/admin-user.service';

import { cinSlots, CIN_SLOTS } from './cin-slots';

// F-docs Commit 4 — pin the CIN recto/verso contract: slot 1 = recto, slot 2 = verso, mapped BY
// POSITION (the server's semantic, mirrored by the admin review). A regression to array-order
// slotting would silently swap the two sides in the modal.
const doc = (id: string, position: number): AdminDocumentView => ({
  id,
  category: 'cin',
  position,
  original_filename: `${id}.pdf`,
  mime_type: 'application/pdf',
  size_bytes: 1024,
  uploaded_at: '2026-06-13T00:00:00.000Z',
});

describe('cinSlots — CIN recto/verso slotting', () => {
  it('slot order is recto (position 1) then verso (position 2)', () => {
    expect(CIN_SLOTS).toEqual([
      { position: 1, label: 'Recto' },
      { position: 2, label: 'Verso' },
    ]);
  });

  it('maps each slot to the document with the matching position', () => {
    const recto = doc('recto', 1);
    const verso = doc('verso', 2);
    const slots = cinSlots([recto, verso]);

    expect(slots[0]).toMatchObject({ position: 1, label: 'Recto', doc: recto });
    expect(slots[1]).toMatchObject({ position: 2, label: 'Verso', doc: verso });
  });

  it('slots by position, NOT array order (reversed input still maps correctly)', () => {
    const recto = doc('recto', 1);
    const verso = doc('verso', 2);
    const slots = cinSlots([verso, recto]);

    expect(slots[0].doc).toBe(recto);
    expect(slots[1].doc).toBe(verso);
  });

  it('leaves a missing side undefined (verso uploaded, recto absent)', () => {
    const slots = cinSlots([doc('verso', 2)]);

    expect(slots[0]).toMatchObject({ label: 'Recto', doc: undefined });
    expect(slots[1].doc?.id).toBe('verso');
  });
});
