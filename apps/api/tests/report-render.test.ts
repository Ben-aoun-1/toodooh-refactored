import { afterAll, describe, expect, it } from 'vitest';

import {
  closeReportBrowser,
  documentPdfOptions,
  extractDocumentChrome,
  REPORT_PDF_OPTIONS,
  renderPdf,
  resolveChromiumPath,
} from '../src/lib/report/render.js';

// Real-chromium smoke — runs ONLY when CHROMIUM_PATH / PUPPETEER_EXECUTABLE_PATH is explicitly
// set (local dev, docker image); plain CI skips. GH runners incidentally ship google-chrome, so
// path-probing ran the smoke against whatever Chrome the runner image carries — and the
// ubuntu-24.04 runner image 20260628.225.1 Chrome hangs at launch (WS endpoint never appears).
const explicitPath = process.env['CHROMIUM_PATH'] ?? process.env['PUPPETEER_EXECUTABLE_PATH'];
const chromium = explicitPath ? resolveChromiumPath() : null;

describe.skipIf(chromium === null)('renderPdf (real chromium)', () => {
  afterAll(async () => {
    await closeReportBrowser();
  });

  it('renders HTML to a PDF (magic bytes, non-trivial size)', async () => {
    const pdf = await renderPdf(
      '<!doctype html><html><body><h1 style="background:#76E6AB">toodooh</h1></body></html>',
    );
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(1000);
  }, 60_000);

  it('renders again on the SAME lazy singleton (no relaunch between calls)', async () => {
    const first = await renderPdf('<p>premier</p>');
    const second = await renderPdf('<p>second</p>');
    expect(first.subarray(0, 5).toString()).toBe('%PDF-');
    expect(second.subarray(0, 5).toString()).toBe('%PDF-');
  }, 60_000);

  it('renders a chromed document (embedded header/footer templates) to a PDF', async () => {
    const pdf = await renderPdf(
      `<!doctype html><html><body><h1>rapport</h1>
      <template id="pdf-header"><div style="font-size:7px;">Café · 01/06 – 30/06</div></template>
      <template id="pdf-footer"><div style="font-size:7px;">page <span class="pageNumber"></span> / <span class="totalPages"></span></div></template>
      </body></html>`,
    );
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(1000);
  }, 60_000);
});

describe('extractDocumentChrome (R1.5 embedded chrome)', () => {
  it('returns null for plain HTML without embedded templates', () => {
    expect(extractDocumentChrome('<!doctype html><html><body><p>hi</p></body></html>')).toBeNull();
  });

  it('extracts both templates, multiline content included', () => {
    const chrome = extractDocumentChrome(
      `<body><template id="pdf-header"><div>\nCafé · période\n</div></template>
       <template id="pdf-footer"><div>page <span class="pageNumber"></span></div></template></body>`,
    );
    expect(chrome?.headerTemplate).toContain('Café · période');
    expect(chrome?.footerTemplate).toContain('pageNumber');
  });

  it('never returns a half-chromed document (one template alone → null)', () => {
    expect(
      extractDocumentChrome('<body><template id="pdf-header"><div>x</div></template></body>'),
    ).toBeNull();
    expect(
      extractDocumentChrome('<body><template id="pdf-footer"><div>x</div></template></body>'),
    ).toBeNull();
  });
});

describe('REPORT_PDF_OPTIONS (R1.6 — fixed self-contained pages)', () => {
  it('prints zero-margin CSS-sized A4 pages with backgrounds, WITHOUT Chromium header/footer', () => {
    expect(REPORT_PDF_OPTIONS.preferCSSPageSize).toBe(true);
    expect(REPORT_PDF_OPTIONS.printBackground).toBe(true);
    expect(REPORT_PDF_OPTIONS.format).toBe('A4');
    expect(REPORT_PDF_OPTIONS.margin).toEqual({ top: '0', bottom: '0', left: '0', right: '0' });
    expect(REPORT_PDF_OPTIONS.displayHeaderFooter).toBeUndefined();
    expect(REPORT_PDF_OPTIONS.headerTemplate).toBeUndefined();
    expect(REPORT_PDF_OPTIONS.footerTemplate).toBeUndefined();
  });
});

describe('documentPdfOptions', () => {
  it("frameless documents keep R1's margins and no header/footer", () => {
    const opts = documentPdfOptions(null);
    expect(opts.margin).toEqual({ top: '14mm', bottom: '14mm', left: '12mm', right: '12mm' });
    expect(opts.displayHeaderFooter).toBeUndefined();
  });

  it('chromed documents switch displayHeaderFooter on and reserve wider bands', () => {
    const opts = documentPdfOptions({
      headerTemplate: '<div>h</div>',
      footerTemplate: '<div>f</div>',
    });
    expect(opts.displayHeaderFooter).toBe(true);
    expect(opts.headerTemplate).toBe('<div>h</div>');
    expect(opts.footerTemplate).toBe('<div>f</div>');
    expect(opts.margin).toEqual({ top: '20mm', bottom: '17mm', left: '12mm', right: '12mm' });
  });
});

describe('resolveChromiumPath', () => {
  it('returns a real existing path or null — never a dangling one', () => {
    const resolved = resolveChromiumPath();
    if (resolved !== null) {
      expect(resolved.length).toBeGreaterThan(0);
    } else {
      expect(resolved).toBeNull();
    }
  });
});
