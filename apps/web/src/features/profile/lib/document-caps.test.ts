import { describe, expect, it } from 'vitest';

import { CIN_SLOT_LABELS, DOCUMENT_CAPS, MAX_DOCUMENT_BYTES } from './document-caps';

// F-docs Commit 2 — the client cap mirror must match the server's CATEGORY_CAPS
// (apps/api lib/user-documents.ts) and the 5 MB multipart limit; a drift here makes
// the inline UX lie (the server would 400/409 picks the UI allowed, or vice versa).
describe('document caps mirror (server contract)', () => {
  it('per-category caps match the server ruling', () => {
    expect(DOCUMENT_CAPS).toEqual({ cin: 2, rne: 2, complementaire: 10, bank: 1 });
  });

  it('size cap mirrors the 5 MB multipart limit', () => {
    expect(MAX_DOCUMENT_BYTES).toBe(5 * 1024 * 1024);
  });

  it('cin slots are semantic: 1=recto, 2=verso', () => {
    expect(CIN_SLOT_LABELS[1]).toBe('Recto');
    expect(CIN_SLOT_LABELS[2]).toBe('Verso');
  });
});
