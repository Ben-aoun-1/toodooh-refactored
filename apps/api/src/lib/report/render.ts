import { existsSync } from 'node:fs';

import puppeteer, { type Browser, type PDFOptions } from 'puppeteer-core';

import { env } from '../../env.js';
import { logger } from '../../logger.js';

const log = logger.child({ module: 'report-render' });

// HTML → PDF via the system chromium (R1). puppeteer-core NEVER downloads a browser — the
// executable must exist on the machine: the docker image installs the alpine chromium and sets
// PUPPETEER_EXECUTABLE_PATH; local dev points CHROMIUM_PATH at whatever chromium it has.
const COMMON_CHROMIUM_PATHS = [
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/google-chrome',
];

export function resolveChromiumPath(): string | null {
  const fromEnv = env.CHROMIUM_PATH ?? process.env['PUPPETEER_EXECUTABLE_PATH'];
  if (fromEnv) return existsSync(fromEnv) ? fromEnv : null;
  return COMMON_CHROMIUM_PATHS.find((p) => existsSync(p)) ?? null;
}

/** Hard ceiling for one render — content settle + PDF emit together. */
export const RENDER_TIMEOUT_MS = 30_000;

// R1.5 document chrome: the template embeds its per-document running header/footer as inert
// <template> tags INSIDE the HTML (renderPdf(html) call sites — endpoints + month-end job — stay
// untouched). Chromium draws these in the page margins, so a chromed document reserves wider
// top/bottom bands than a frameless one.
export interface DocumentChrome {
  headerTemplate: string;
  footerTemplate: string;
}

const chromeTemplate = (html: string, id: string): string | null => {
  const match = html.match(new RegExp(`<template id="${id}">([\\s\\S]*?)</template>`));
  return match?.[1] ?? null;
};

/** Pull the optional embedded header/footer chrome; both tags or nothing (never half-chromed). */
export function extractDocumentChrome(html: string): DocumentChrome | null {
  const headerTemplate = chromeTemplate(html, 'pdf-header');
  const footerTemplate = chromeTemplate(html, 'pdf-footer');
  if (headerTemplate === null || footerTemplate === null) return null;
  return { headerTemplate, footerTemplate };
}

/** R1's frameless margins — plain HTML (no embedded chrome) renders exactly as before. */
const PLAIN_MARGIN = { top: '14mm', bottom: '14mm', left: '12mm', right: '12mm' };
/** Chromed margins — room for the running header/footer without colliding with content. */
const CHROME_MARGIN = { top: '20mm', bottom: '17mm', left: '12mm', right: '12mm' };

/** The pdf() option fragment a document's chrome selects (pure — unit-tested without chromium). */
export function documentPdfOptions(chrome: DocumentChrome | null): PDFOptions {
  if (chrome === null) return { margin: PLAIN_MARGIN };
  return {
    margin: CHROME_MARGIN,
    displayHeaderFooter: true,
    headerTemplate: chrome.headerTemplate,
    footerTemplate: chrome.footerTemplate,
  };
}

// R1.6 — the dark document lays out five FIXED 210×297mm pages and carries its running head /
// footer IN-DOM (literal page numbers), so Chromium's displayHeaderFooter stays OFF and the
// margins are zero: each .page self-contains its padding. preferCSSPageSize honors the
// template's `@page{ size:A4; margin:0 }` (Chromium's own "A4" paper is 8.27×11.69in ≈ 296.9mm —
// a hair SHORT of the 297mm pages, which would spill blank pages without it).
export const REPORT_PDF_OPTIONS: PDFOptions = {
  format: 'A4', // fallback for documents WITHOUT an @page rule (preferCSSPageSize wins otherwise)
  preferCSSPageSize: true,
  printBackground: true,
  margin: { top: '0', bottom: '0', left: '0', right: '0' },
};

// Lazy singleton: the browser launches on the FIRST render (api boot cost stays zero) and is
// reused across renders. A crash/disconnect clears the memo so the next render relaunches —
// the classic poisoned-promise guard.
let browserPromise: Promise<Browser> | null = null;

async function launchBrowser(): Promise<Browser> {
  const executablePath = resolveChromiumPath();
  if (!executablePath) {
    throw new Error(
      'No chromium executable found (set CHROMIUM_PATH or PUPPETEER_EXECUTABLE_PATH)',
    );
  }
  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    // --no-sandbox: the api container runs as a non-root single-tenant process rendering ONLY
    // our own template (no untrusted navigation); alpine chromium has no usable sandbox helper.
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--hide-scrollbars'],
  });
  browser.on('disconnected', () => {
    log.warn('chromium disconnected — next render relaunches');
    browserPromise = null;
  });
  return browser;
}

function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = launchBrowser().catch((err: unknown) => {
      browserPromise = null;
      throw err;
    });
  }
  return browserPromise;
}

/**
 * Render one self-contained HTML document to an A4 PDF. `printBackground` keeps the report's
 * palette; a hard 30s ceiling covers content settle + emit. On ANY failure the browser is torn
 * down (crash-safe relaunch on the next call) and the error rethrown for the caller's 503.
 */
export async function renderPdf(html: string): Promise<Buffer> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    const work = (async () => {
      await page.setContent(html, { waitUntil: 'load', timeout: RENDER_TIMEOUT_MS });
      // Let the template's font import settle when the network allows (string-evaluated: the api
      // tsconfig has no DOM lib). A dead network resolves the promise with fallback fonts.
      await page.evaluate('document.fonts.ready.then(() => undefined)');
      const pdf = await page.pdf({
        ...REPORT_PDF_OPTIONS,
        timeout: RENDER_TIMEOUT_MS,
      });
      return Buffer.from(pdf);
    })();
    const ceiling = new Promise<never>((_, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`report render exceeded ${RENDER_TIMEOUT_MS}ms`)),
        RENDER_TIMEOUT_MS,
      );
      timer.unref();
    });
    return await Promise.race([work, ceiling]);
  } catch (err) {
    // Crash OR timeout: don't trust the browser any more — close + clear so the next render
    // starts clean. close() failures are swallowed (the process may already be gone).
    browserPromise = null;
    await browser.close().catch(() => undefined);
    throw err;
  } finally {
    await page.close().catch(() => undefined);
  }
}

/** Test/shutdown hook — closes the singleton if it was ever launched. */
export async function closeReportBrowser(): Promise<void> {
  if (!browserPromise) return;
  const pending = browserPromise;
  browserPromise = null;
  const browser = await pending.catch(() => null);
  await browser?.close().catch(() => undefined);
}
