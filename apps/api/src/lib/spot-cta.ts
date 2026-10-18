import { randomBytes } from 'node:crypto';

import { type SQL, sql } from 'drizzle-orm';

import { campaigns, creatives } from '../db/schema.js';

// QR-CTA1 (Youssef 2026-10-18, tested quietly) — a spot's CALL TO ACTION. At the spot step the
// screencaster may give the campaign a link and a short message (≤ 20 characters). The server
// burns a QR code + that message into a COPY of the creative, bottom-left (lib/spot-cta-burn.ts),
// and the TV airs the copy — no TV change: the playlist entry id is the campaign id, so a TV caches
// the copy from the campaign's very first airing. The QR points at Toodooh's own redirect
// (GET /q/<code>), which counts the scan and sends the viewer on to the link: the visit data is
// the point of the feature.
//
// ONE home for the rules (pure, unit-tested) and for the two SQL fragments every playout reader
// uses: a campaign with a link airs only once its copy is ready for its CURRENT creative, and then
// airs the copy.

/** The message under the QR when the screencaster gives none. */
export const CTA_DEFAULT_LABEL = 'Pour en savoir plus';
export const CTA_LABEL_MAX_CHARS = 20;
export const CTA_URL_MAX_CHARS = 2000;
/** The smallest QR side worth airing (a spot under ~400 px high cannot carry a readable one). */
export const CTA_MIN_QR_PX = 96;

export type CtaStatus = 'pending' | 'ready' | 'failed';

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

/** The link: https only, a real host name, no credentials, at most 2000 characters. */
export function parseCtaUrl(raw: string): Parsed<string> {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { ok: false, error: 'CTA_URL_REQUIRED' };
  if (trimmed.length > CTA_URL_MAX_CHARS) return { ok: false, error: 'CTA_URL_TOO_LONG' };
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, error: 'CTA_URL_INVALID' };
  }
  if (url.protocol !== 'https:') return { ok: false, error: 'CTA_URL_NOT_HTTPS' };
  if (url.username !== '' || url.password !== '') return { ok: false, error: 'CTA_URL_INVALID' };
  const host = url.hostname;
  if (!host.includes('.') || host.startsWith('.') || host.endsWith('.')) {
    return { ok: false, error: 'CTA_URL_INVALID' };
  }
  return { ok: true, value: url.toString() };
}

// Control characters would reach ffmpeg's text renderer as-is.
const CONTROL_CHARS = /\p{Cc}/u;

/** The message: trimmed, empty = none (the default is drawn), at most 20 characters. */
export function parseCtaLabel(raw: string | null | undefined): Parsed<string | null> {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  const trimmed = raw.trim().replace(/\s+/g, ' ');
  if (trimmed.length === 0) return { ok: true, value: null };
  if ([...trimmed].length > CTA_LABEL_MAX_CHARS) return { ok: false, error: 'CTA_LABEL_TOO_LONG' };
  if (CONTROL_CHARS.test(trimmed)) return { ok: false, error: 'CTA_LABEL_INVALID' };
  return { ok: true, value: trimmed };
}

/** The words drawn under the QR. */
export const ctaDrawnLabel = (label: string | null): string => label ?? CTA_DEFAULT_LABEL;

// No 0/O, 1/l/I: a code someone may read aloud or type from a photo.
const CODE_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';
const CODE_LENGTH = 8;

/** A fresh short code (8 characters, ~40 bits). Uniqueness is the column's constraint. */
export function newCtaCode(random: (n: number) => Buffer = randomBytes): string {
  const bytes = random(CODE_LENGTH);
  let code = '';
  for (const b of bytes) code += CODE_ALPHABET.charAt(b % CODE_ALPHABET.length);
  return code;
}

export const isCtaCode = (code: string): boolean =>
  code.length === CODE_LENGTH && [...code].every((c) => CODE_ALPHABET.includes(c));

/** What the QR encodes: the scan-counting redirect, never the link itself. */
export const ctaScanUrl = (baseUrl: string, code: string): string =>
  `${baseUrl.replace(/\/+$/, '')}/q/${code}`;

/** The card burned into the spot, in the creative's own pixels. */
export interface CtaGeometry {
  /** QR side. */
  qr: number;
  /** Card size (white, QR on top, the message under it). */
  cardWidth: number;
  cardHeight: number;
  /** White margin around the QR inside the card. */
  margin: number;
  /** Message font size. */
  fontSize: number;
  /** Card top-left corner in the creative. */
  x: number;
  y: number;
}

const even = (n: number): number => Math.max(2, Math.round(n / 2) * 2);

/**
 * Where the card goes. The TV letterboxes a VIDEO (whole frame visible) but CROPS an IMAGE to the
 * 16:9 screen (centerCrop), so an image's card is placed inside the part the TV shows. The card
 * keeps clear of the screen's edges and of the full-screen player's bottom status bar (~6 % of
 * the height): 3 % from the left, 9 % from the bottom of the visible area.
 */
export function ctaGeometry(width: number, height: number, kind: 'video' | 'photo'): CtaGeometry {
  let visX = 0;
  let visY = 0;
  let visW = width;
  let visH = height;
  if (kind === 'photo') {
    const screen = 16 / 9;
    if (width / height > screen) {
      visW = height * screen;
      visX = (width - visW) / 2;
    } else if (width / height < screen) {
      visH = width / screen;
      visY = (height - visH) / 2;
    }
  }
  const qr = even(visH * 0.24);
  const margin = even(qr * 0.08);
  const cardWidth = even(qr * 1.45);
  const fontSize = Math.max(10, Math.round(qr * 0.11));
  const cardHeight = even(qr + margin * 2 + fontSize * 1.6);
  const x = Math.round(visX + visH * 0.03);
  const y = Math.round(visY + visH - visH * 0.09 - cardHeight);
  return { qr, cardWidth, cardHeight, margin, fontSize, x, y };
}

/** The ffmpeg filter graph: input 0 = the spot, input 1 = the QR png (already `qr` px wide). */
export function ctaFilterGraph(g: CtaGeometry, fontFile: string, labelFile: string): string {
  const card =
    `[1:v]pad=${g.cardWidth}:${g.cardHeight}:${(g.cardWidth - g.qr) / 2}:${g.margin}:white,` +
    `drawtext=fontfile=${fontFile}:textfile=${labelFile}:expansion=none:fontcolor=0x204B43:` +
    `fontsize=${g.fontSize}:x=(w-text_w)/2:y=${g.qr + g.margin}+(h-${g.qr + g.margin}-text_h)/2[card]`;
  return `${card};[0:v][card]overlay=${g.x}:${g.y}[out]`;
}

/**
 * SQL predicate on `campaigns`: the campaign may air as far as its call to action goes — it has
 * none, or its copy is ready and was made from the creative it links NOW.
 */
export const ctaAirableSql = (): SQL =>
  sql`(${campaigns.ctaUrl} IS NULL OR (${campaigns.ctaStatus} = 'ready' AND ${campaigns.ctaSourceCreativeId} = ${campaigns.creativeId} AND ${campaigns.ctaStorageKey} IS NOT NULL))`;

/**
 * SQL: the object the TV airs — the QR copy when the campaign has a link and its copy exists, else
 * the creative. (Playout readers also apply ctaAirableSql, so the copy is always the current one
 * there; the owner's preview shows the copy as soon as one exists.)
 */
export const airedStorageKeySql = (): SQL<string> =>
  sql<string>`CASE WHEN ${campaigns.ctaUrl} IS NOT NULL AND ${campaigns.ctaStorageKey} IS NOT NULL THEN ${campaigns.ctaStorageKey} ELSE ${creatives.storageKey} END`;

/** The campaign's call-to-action state for the cart gate. */
export function ctaCartBlock(row: {
  ctaUrl: string | null;
  ctaStatus: string | null;
  ctaSourceCreativeId: string | null;
  creativeId: string | null;
}): 'SPOT_QR_FAILED' | null {
  if (row.ctaUrl === null) return null;
  return row.ctaStatus === 'failed' && row.ctaSourceCreativeId === row.creativeId
    ? 'SPOT_QR_FAILED'
    : null;
}
