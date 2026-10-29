// QR-CTA2 (Mariem 27/10 point 1) — WHERE and WHEN the call-to-action card sits in the spot, pure
// (pinned in tests/spot-cta-rules.test.ts). The design is Mariem's QR_Danette_anime_5s_v5.mp4:
// bottom-left, a white rounded QR tile framed by four mint corner brackets that pulse, over a dark
// frosted card (« Scannez le code », the advertiser's words, a mint line, « POWERED BY toodooh »).
// It appears 2 s after the spot starts and leaves 2 s before it ends.
//
// Sizes are the video's pixels at 1080 p, scaled by the frame height (a 720 p spot gets 2/3 of
// each). The card is always burned into a VIDEO frame: a photo spot is first turned into a 16:9
// video (lib/spot-cta-burn.ts), so the whole frame is what the TV shows.

/** Seconds after the start / before the end of the spot during which the card stays hidden. */
export const CTA_SHOW_AFTER_SECONDS = 2;
export const CTA_HIDE_BEFORE_SECONDS = 2;
/** Fade in / out. */
export const CTA_FADE_SECONDS = 0.35;
/** One full pulse of the brackets (out and back). */
export const CTA_PULSE_PERIOD_SECONDS = 1.6;

export interface CtaLayout {
  /** The scale (frame height / 1080). */
  unit: number;
  /** The frosted card. */
  panel: { x: number; y: number; width: number; height: number; radius: number };
  /** The white QR tile (its top overlaps the card). */
  tile: { x: number; y: number; size: number; radius: number };
  /** The QR code's side, inside the tile. */
  qr: number;
  /** The card layer image: the tile + the card, as one transparent PNG. */
  layer: { x: number; y: number; width: number; height: number };
  /** One corner bracket image (mirrored for the other three), its glow included. */
  bracket: { size: number; arm: number; stroke: number; glow: number; gap: number };
  /** How far the brackets move out at the top of a pulse. */
  pulse: number;
}

const even = (n: number): number => Math.max(2, Math.round(n / 2) * 2);

/** Sized by the frame HEIGHT only: even a vertical 720×1280 spot keeps the card well inside. */
export function ctaLayout(height: number): CtaLayout {
  const u = height / 1080;
  const panelWidth = even(300 * u);
  const panelHeight = even(168 * u);
  const panelX = even(72 * u);
  const panelY = even(height - 76 * u - panelHeight);
  const tileSize = even(184 * u);
  const overlap = even(26 * u);
  const tileX = even(panelX + (panelWidth - tileSize) / 2);
  const tileY = even(panelY - tileSize + overlap);
  const arm = even(34 * u);
  const stroke = Math.max(2, Math.round(5 * u));
  const glow = even(10 * u);
  return {
    unit: u,
    panel: { x: panelX, y: panelY, width: panelWidth, height: panelHeight, radius: even(20 * u) },
    tile: { x: tileX, y: tileY, size: tileSize, radius: even(18 * u) },
    qr: even(tileSize - 2 * 14 * u),
    layer: { x: panelX, y: tileY, width: panelWidth, height: panelY + panelHeight - tileY },
    bracket: { size: arm + 2 * glow, arm, stroke, glow, gap: even(10 * u) },
    pulse: Math.max(2, Math.round(6 * u)),
  };
}

/**
 * When the card shows, in seconds from the start of a spot of `duration` seconds: from 2 s to
 * `duration` − 2 s. A spot too short for that (under 6 s, older uploads) shows it throughout.
 */
export function ctaWindow(duration: number): { start: number; end: number } {
  const start = CTA_SHOW_AFTER_SECONDS;
  const end = duration - CTA_HIDE_BEFORE_SECONDS;
  return end - start >= 2 ? { start, end } : { start: 0, end: duration };
}

const num = (n: number): string => String(Math.round(n * 1000) / 1000);

/**
 * The ffmpeg graph. Inputs: [0:v] the spot frame stream (`frame` names it when a photo was
 * pre-scaled), [1:v] the card layer PNG, [2:v] the card shape mask PNG, [3:v] the corner bracket
 * PNG — 1 to 3 looped for the spot's length. Output: [out].
 */
export function ctaFilterGraph(layout: CtaLayout, duration: number, frame: string = '0:v'): string {
  const { start, end } = ctaWindow(duration);
  const fadeOut = Math.max(start, end - CTA_FADE_SECONDS);
  const fades = `fade=t=in:st=${num(start)}:d=${CTA_FADE_SECONDS}:alpha=1,fade=t=out:st=${num(fadeOut)}:d=${CTA_FADE_SECONDS}:alpha=1`;
  const { panel, tile, bracket, layer } = layout;
  // Pulse: 0 → `pulse` px outwards and back, once per period, from the card's first frame.
  const d = `(${layout.pulse}*(1-cos(2*PI*(t-${num(start)})/${CTA_PULSE_PERIOD_SECONDS}))/2)`;
  const left = tile.x - bracket.gap - bracket.glow;
  const top = tile.y - bracket.gap - bracket.glow;
  const right = tile.x + tile.size + bracket.gap + bracket.glow - bracket.size;
  const bottom = tile.y + tile.size + bracket.gap + bracket.glow - bracket.size;
  return [
    `[${frame}]split=2[base][bg]`,
    `[bg]crop=${panel.width}:${panel.height}:${panel.x}:${panel.y},boxblur=luma_radius=${Math.max(2, Math.round(18 * layout.unit))}:luma_power=2,format=rgba[blur]`,
    `[2:v]format=rgba,alphaextract[shape]`,
    `[blur][shape]alphamerge,${fades}[glass]`,
    `[base][glass]overlay=${panel.x}:${panel.y}:shortest=1[g1]`,
    `[1:v]format=rgba,${fades}[card]`,
    `[g1][card]overlay=${layer.x}:${layer.y}:shortest=1[g2]`,
    `[3:v]format=rgba,${fades},split=4[k0][k1][k2][k3]`,
    `[k1]hflip[k1f]`,
    `[k2]vflip[k2f]`,
    `[k3]hflip,vflip[k3f]`,
    `[g2][k0]overlay=x='${left}-${d}':y='${top}-${d}':eval=frame:shortest=1[g3]`,
    `[g3][k1f]overlay=x='${right}+${d}':y='${top}-${d}':eval=frame:shortest=1[g4]`,
    `[g4][k2f]overlay=x='${left}-${d}':y='${bottom}+${d}':eval=frame:shortest=1[g5]`,
    `[g5][k3f]overlay=x='${right}+${d}':y='${bottom}+${d}':eval=frame:shortest=1[out]`,
  ].join(';');
}
