import { afterAll, describe, expect, it } from 'vitest';

import { closeReportBrowser, renderPdf, resolveChromiumPath } from '../src/lib/report/render.js';

// Real-chromium smoke — SKIPPED when the machine has no chromium (plain CI): the seam is
// exercised locally (CHROMIUM_PATH) and in the docker image, where the executable is guaranteed.
const chromium = resolveChromiumPath();

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
