import { describe, expect, it } from 'vitest';

import { filenameFromContentDisposition } from './download-filename';

// PERF-QA1 R3 — the api's content-disposition carries the venue slug; the client parses it so
// the slug algorithm has ONE home (api-side).
describe('filenameFromContentDisposition', () => {
  it('extracts a quoted filename', () => {
    expect(
      filenameFromContentDisposition('inline; filename="rapport-cafe-periode-2026-06.pdf"'),
    ).toBe('rapport-cafe-periode-2026-06.pdf');
  });

  it('extracts a bare (unquoted) filename', () => {
    expect(filenameFromContentDisposition('attachment; filename=rapport-2026-06.pdf')).toBe(
      'rapport-2026-06.pdf',
    );
  });

  it('null on a missing or filename-less header (callers keep their legacy name)', () => {
    expect(filenameFromContentDisposition(null)).toBe(null);
    expect(filenameFromContentDisposition('inline')).toBe(null);
  });
});
