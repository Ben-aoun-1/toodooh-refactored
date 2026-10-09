import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { logger } from '../../logger.js';

// Operator 2026-10-09 — every Toodooh document carries the REAL logo (the « toodooh » wordmark +
// the green mark), never a typed word. Two committed variants under apps/api/assets:
//   logo.png        — dark wordmark on white, for light paper;
//   logo-light.png  — off-white wordmark on transparency, for the report's deep-green paper.
// Resolved relative to THIS module (src/ under tsx/vitest, dist/ in the image — assets/ is a
// sibling of both; the Dockerfile copies it). Read once, inlined as a data URI so the HTML stays
// self-contained (no file:// access from chromium). A missing asset degrades to the text wordmark.

const log = logger.child({ module: 'pdf-doc-logo' });

export type LogoVariant = 'onDark' | 'onLight';

const FILES: Record<LogoVariant, string> = {
  onDark: 'logo-light.png',
  onLight: 'logo.png',
};

const cache = new Map<LogoVariant, string | null>();

/** The logo as a data URI, or null when the asset is missing (the caller falls back to text). */
export const logoDataUri = (variant: LogoVariant): string | null => {
  const hit = cache.get(variant);
  if (hit !== undefined) return hit;
  let uri: string | null = null;
  try {
    const bytes = readFileSync(
      fileURLToPath(new URL(`../../../assets/${FILES[variant]}`, import.meta.url)),
    );
    uri = `data:image/png;base64,${bytes.toString('base64')}`;
  } catch (err) {
    log.warn({ err, variant }, 'document logo asset missing — rendering the text wordmark');
  }
  cache.set(variant, uri);
  return uri;
};

/** The logo <img>, or the report's two-tone text wordmark when the asset is unavailable. */
export const logoHtml = (variant: LogoVariant, cls: string): string => {
  const uri = logoDataUri(variant);
  return uri === null
    ? `<span class="${cls} ${cls}--text">tood<b>oo</b>h</span>`
    : `<img class="${cls}" src="${uri}" alt="toodooh">`;
};
