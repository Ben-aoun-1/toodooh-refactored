import { describe, expect, it } from 'vitest';

import * as documentCaps from './document-caps';

const { DOCUMENT_CAPS, MAX_DOCUMENT_BYTES } = documentCaps;

// F-docs Commit 2 — the client cap mirror must match the server's CATEGORY_CAPS
// (apps/api lib/user-documents.ts) and the 5 MB multipart limit; a drift here makes
// the inline UX lie (the server would 400/409 picks the UI allowed, or vice versa).
describe('document caps mirror (server contract)', () => {
  it('per-category caps match the server ruling — no cin since CIN-HOST1', () => {
    expect(DOCUMENT_CAPS).toEqual({ rne: 2, complementaire: 10, bank: 1 });
  });

  it('size cap mirrors the 5 MB multipart limit', () => {
    expect(MAX_DOCUMENT_BYTES).toBe(5 * 1024 * 1024);
  });

  it('CIN-HOST1: no CIN slot labels are exported any more', () => {
    expect(Object.keys(documentCaps)).not.toContain('CIN_SLOT_LABELS');
  });
});
