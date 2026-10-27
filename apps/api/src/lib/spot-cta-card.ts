import { esc } from './pdf-doc/document.js';
import { logoDataUri } from './pdf-doc/logo.js';
import type { CtaLayout } from './spot-cta-layout.js';

// QR-CTA2 (Mariem 27/10 point 1) — the three transparent layers chromium draws for the burn
// (lib/spot-cta-burn.ts composes them over the spot with ffmpeg): the card (QR tile + frosted
// card's tint, words, mint line, « POWERED BY » + the real light logo), the card's shape (where
// ffmpeg blurs the video, the « frosted » part), and ONE corner bracket (mirrored into four).
// Every size comes from ctaLayout, in the spot's own pixels.

const FONT_IMPORT =
  "@import url('https://fonts.googleapis.com/css2?family=Geist:wght@400;500;700&display=swap');";
const BRAND_MINT = '#76E6AB';
const BRAND_INK = '#0D2B1F';

const page = (width: number, height: number, css: string, body: string): string =>
  `<!doctype html><html><head><meta charset="utf-8"><style>${FONT_IMPORT}
html,body{margin:0;padding:0;background:transparent;width:${width}px;height:${height}px;overflow:hidden}
*{box-sizing:border-box}
${css}</style></head><body>${body}</body></html>`;

const px = (n: number): string => `${Math.round(n * 100) / 100}px`;

/** The card layer: `layout.layer` sized, the tile at its top, the card below it. */
export function ctaCardHtml(layout: CtaLayout, qrDataUri: string, label: string): string {
  const { unit: u, panel, tile, layer } = layout;
  const tileLeft = tile.x - layer.x;
  const panelTop = panel.y - layer.y;
  const textTop = tile.y + tile.size - panel.y + 26 * u;
  const logo = logoDataUri('onDark');
  const css = `
.card{position:absolute;left:0;top:${px(panelTop)};width:${px(panel.width)};height:${px(panel.height)};
  border-radius:${px(panel.radius)};background:rgba(16,30,24,0.34);border:${px(Math.max(1, u))} solid rgba(255,255,255,0.16);
  font-family:'Geist',system-ui,'FreeSans',sans-serif;color:#fff;text-align:center;padding-top:${px(textTop)}}
.title{font-weight:700;font-size:${px(23 * u)};line-height:1.15;letter-spacing:-0.01em}
.label{margin-top:${px(4 * u)};font-weight:400;font-size:${px(15.5 * u)};color:rgba(255,255,255,0.88);white-space:nowrap}
.line{margin:${px(10 * u)} auto 0;width:${px(30 * u)};height:${px(Math.max(2, 3 * u))};border-radius:${px(2 * u)};background:${BRAND_MINT}}
.powered{margin-top:${px(9 * u)};display:flex;align-items:center;justify-content:center;gap:${px(7 * u)};
  font-size:${px(9 * u)};font-weight:500;letter-spacing:0.28em;color:rgba(255,255,255,0.6)}
.powered img{height:${px(11 * u)};width:auto;opacity:0.9}
.powered b{font-weight:700;letter-spacing:0;color:rgba(255,255,255,0.85);font-size:${px(11 * u)}}
.tile{position:absolute;left:${px(tileLeft)};top:0;width:${px(tile.size)};height:${px(tile.size)};
  border-radius:${px(tile.radius)};background:#fff;display:flex;align-items:center;justify-content:center;
  box-shadow:0 ${px(6 * u)} ${px(18 * u)} rgba(0,0,0,0.28)}
.tile img{width:${px(layout.qr)};height:${px(layout.qr)};image-rendering:pixelated}`;
  const brand = logo ? `<img src="${logo}" alt="toodooh">` : '<b>toodooh</b>';
  const body = `<div class="card"><div class="title">Scannez le code</div><div class="label">${esc(label)}</div><div class="line"></div><div class="powered"><span>POWERED BY</span>${brand}</div></div><div class="tile"><img src="${qrDataUri}" alt=""></div>`;
  return page(layer.width, layer.height, css, body);
}

/** The card's shape, opaque where the video gets frosted (its alpha is the mask). */
export function ctaShapeHtml(layout: CtaLayout): string {
  const { panel } = layout;
  return page(
    panel.width,
    panel.height,
    `.s{width:100%;height:100%;border-radius:${px(panel.radius)};background:#fff}`,
    '<div class="s"></div>',
  );
}

/** One TOP-LEFT corner bracket with its mint glow (ffmpeg mirrors it for the other corners). */
export function ctaBracketHtml(layout: CtaLayout): string {
  const { bracket: b, unit: u } = layout;
  return page(
    b.size,
    b.size,
    `.b{position:absolute;left:${px(b.glow)};top:${px(b.glow)};width:${px(b.arm)};height:${px(b.arm)};
  border-top:${px(b.stroke)} solid ${BRAND_MINT};border-left:${px(b.stroke)} solid ${BRAND_MINT};
  border-top-left-radius:${px(10 * u)};filter:drop-shadow(0 0 ${px(5 * u)} rgba(118,230,171,0.75))}`,
    '<div class="b"></div>',
  );
}

/** The QR's colours on the white tile (the brand's darkest green reads as black to a camera). */
export const CTA_QR_DARK = BRAND_INK;
