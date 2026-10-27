import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import QRCode from 'qrcode';

import { env } from '../env.js';

import { probeMedia } from './media-probe.js';
import { renderPng, resolveChromiumPath } from './report/render.js';
import { CTA_QR_DARK, ctaBracketHtml, ctaCardHtml, ctaShapeHtml } from './spot-cta-card.js';
import { ctaFilterGraph, ctaLayout } from './spot-cta-layout.js';
import { CTA_MIN_QR_PX } from './spot-cta.js';

// QR-CTA1 → QR-CTA2 (Mariem 27/10 point 1) — burns the call-to-action card into a COPY of a
// creative: chromium draws the card's layers (lib/spot-cta-card.ts), ffmpeg frosts the video
// behind it, pulses the brackets and shows it from 2 s to the end − 2 s (lib/spot-cta-layout.ts).
// The copy is ALWAYS an H.264 MP4 (yuv420p, faststart): a video keeps its size, length and audio;
// a PHOTO becomes a 1920×1080 video of its diffusion length (ruling 2026-10-27), centre-cropped to
// 16:9 like the TV crops an image — so the card can come and go like on a video. The playlist
// then announces it as a video (lib/spot-cta.ts airedCreativeTypeSql). The original is never
// touched. ffmpeg / ffprobe / chromium come from the api image.

const execFileAsync = promisify(execFile);

// A 30 s 1080p spot re-encodes in well under a minute with the veryfast preset; 3 min is the
// ceiling before the burn is declared failed (the job retries nothing on its own — see the job).
const BURN_TIMEOUT_MS = 180_000;
/** A photo's copy: the TV's own frame. */
const PHOTO_FRAME = { width: 1920, height: 1080 };
const PHOTO_FPS = 25;
const DEFAULT_PHOTO_SECONDS = 10;

export class CtaBurnError extends Error {}

export interface BurnInput {
  bytes: Buffer;
  kind: 'video' | 'photo';
  mimeType: string | null;
  /** What the QR encodes (the /q/<code> redirect). */
  qrUrl: string;
  /** The advertiser's words under « Scannez le code ». */
  label: string;
  /** The spot's length: a photo's diffusion duration (a video's is measured). */
  durationSeconds: number | null;
}

export interface BurnOutput {
  bytes: Buffer;
  contentType: string;
  extension: string;
}

export type CtaBurner = (input: BurnInput) => Promise<BurnOutput>;

/** The real burner (ffmpeg + chromium). Throws CtaBurnError with a short reason when it cannot. */
export const burnCtaIntoSpot: CtaBurner = async (input) => {
  const ffmpeg = env.FFMPEG_PATH;
  if (!ffmpeg) throw new CtaBurnError('FFMPEG_UNAVAILABLE');
  if (!resolveChromiumPath()) throw new CtaBurnError('CHROMIUM_UNAVAILABLE');
  const probed = await probeMedia(input.bytes).catch(() => {
    throw new CtaBurnError('SPOT_UNREADABLE');
  });
  if (probed.width === null || probed.height === null) throw new CtaBurnError('SPOT_UNREADABLE');
  const isPhoto = input.kind === 'photo';
  const frame = isPhoto ? PHOTO_FRAME : { width: probed.width, height: probed.height };
  const duration = isPhoto
    ? (input.durationSeconds ?? DEFAULT_PHOTO_SECONDS)
    : (probed.durationSeconds ?? input.durationSeconds ?? 0);
  if (!(duration > 0)) throw new CtaBurnError('SPOT_UNREADABLE');
  const layout = ctaLayout(frame.height);
  // Below ~4 px a module a phone camera cannot read the code off a TV: refuse rather than air it.
  if (layout.qr < CTA_MIN_QR_PX) throw new CtaBurnError('SPOT_TOO_SMALL');

  const dir = await mkdtemp(join(tmpdir(), 'toodooh-cta-'));
  try {
    const source = join(dir, 'source');
    const card = join(dir, 'card.png');
    const shape = join(dir, 'shape.png');
    const bracket = join(dir, 'bracket.png');
    const output = join(dir, 'out.mp4');
    await writeFile(source, input.bytes);
    const qr = await QRCode.toDataURL(input.qrUrl, {
      errorCorrectionLevel: 'M',
      margin: 0,
      width: layout.qr,
      color: { dark: CTA_QR_DARK, light: '#ffffff' },
    });
    try {
      await writeFile(
        card,
        await renderPng(
          ctaCardHtml(layout, qr, input.label),
          layout.layer.width,
          layout.layer.height,
        ),
      );
      await writeFile(
        shape,
        await renderPng(ctaShapeHtml(layout), layout.panel.width, layout.panel.height),
      );
      await writeFile(
        bracket,
        await renderPng(ctaBracketHtml(layout), layout.bracket.size, layout.bracket.size),
      );
    } catch (err) {
      throw new CtaBurnError(
        `CARD_RENDER_FAILED ${err instanceof Error ? err.message.slice(0, 200) : ''}`.trim(),
      );
    }

    const seconds = String(duration);
    const looped = (file: string) => [
      '-loop',
      '1',
      '-framerate',
      String(PHOTO_FPS),
      '-t',
      seconds,
      '-i',
      file,
    ];
    // A photo: centre-crop to 16:9 (what the TV shows of an image), then the TV's frame size.
    const prefix = isPhoto
      ? `[0:v]crop=w='if(gt(a,16/9),ih*16/9,iw)':h='if(gt(a,16/9),ih,iw*9/16)',scale=${frame.width}:${frame.height},setsar=1[frame];`
      : '';
    const graph = `${prefix}${ctaFilterGraph(layout, duration, isPhoto ? 'frame' : '0:v')};[out]format=yuv420p[v]`;
    const args = [
      '-v',
      'error',
      '-y',
      ...(isPhoto ? looped(source) : ['-i', source]),
      ...looped(card),
      ...looped(shape),
      ...looped(bracket),
      '-filter_complex',
      graph,
      '-map',
      '[v]',
      ...(isPhoto ? [] : ['-map', '0:a?', '-c:a', 'copy']),
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '20',
      ...(isPhoto ? ['-r', String(PHOTO_FPS), '-t', seconds] : []),
      '-movflags',
      '+faststart',
      output,
    ];
    try {
      await execFileAsync(ffmpeg, args, { timeout: BURN_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 });
    } catch (err) {
      const stderr =
        typeof err === 'object' && err !== null && 'stderr' in err ? String(err.stderr) : '';
      throw new CtaBurnError(`FFMPEG_FAILED ${stderr.slice(-300)}`.trim());
    }
    return { bytes: await readFile(output), contentType: 'video/mp4', extension: 'mp4' };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};
