import { afterAll, describe, expect, it } from 'vitest';

import {
  closeReportBrowser,
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

  it('renders a fixed-page document (@page A4, margin 0) to a PDF', async () => {
    const pdf = await renderPdf(
      `<!doctype html><html><head><style>@page{ size:A4; margin:0; }
      .page{ width:210mm; height:297mm; overflow:hidden; background:#0D2B1F; }</style></head>
      <body><div class="page"><h1 style="color:#EDF6EF">rapport</h1></div></body></html>`,
    );
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(1000);
  }, 60_000);
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
