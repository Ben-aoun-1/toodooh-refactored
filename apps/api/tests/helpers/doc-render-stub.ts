// Operator 2026-10-09 — every document renders through the report's chromium pipeline
// (lib/report/render renderPdf). Suites stub that seam so they run machine-independent (no
// chromium in CI): the « PDF » is the document's own HTML behind a %PDF marker, and docText()
// reads it back as plain text — the successor of the pdfkit hex-run decoders.
//
//   vi.mock('../src/lib/report/render.js', async (importOriginal) => ({
//     ...(await importOriginal<typeof import('../src/lib/report/render.js')>()),
//     renderPdf: (await import('./helpers/doc-render-stub.js')).renderPdfStub,
//   }));

export const renderPdfStub = (html: string): Promise<Buffer> =>
  Promise.resolve(Buffer.from(`%PDF-stub\n${html}`, 'utf8'));

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
};

/** The visible text of a stubbed document: tags stripped, entities decoded, spaces collapsed. */
export const docText = (pdf: Buffer): string =>
  pdf
    .toString('utf8')
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(amp|lt|gt|quot|#39);/g, (m) => ENTITIES[m] ?? m)
    .replace(/[\s\u202f]+/g, ' ')
    .trim();
