import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import QRCode from 'qrcode';

import { env } from '../env.js';

import { probeMedia } from './media-probe.js';
import { CTA_MIN_QR_PX, ctaFilterGraph, ctaGeometry } from './spot-cta.js';

// QR-CTA1 — burns the call-to-action card (QR + message) into a COPY of a creative with ffmpeg:
// temp files in, one ffmpeg run, the copy's bytes out. Videos are re-encoded H.264 (yuv420p,
// faststart) with the audio copied as-is; photos keep their format (PNG → PNG, JPEG → JPEG).
// The original is never touched. ffmpeg and ffprobe come from the api image (FFMPEG_PATH /
// FFPROBE_PATH); the font is the image's FreeSans Bold (ttf-freefont).

const execFileAsync = promisify(execFile);

export const CTA_FONT_DEFAULT = '/usr/share/fonts/freefont/FreeSansBold.otf';

// A 30 s 1080p spot re-encodes in well under a minute with the veryfast preset; 3 min is the
// ceiling before the burn is declared failed (the job retries nothing on its own — see the job).
const BURN_TIMEOUT_MS = 180_000;

export class CtaBurnError extends Error {}

export interface BurnInput {
  bytes: Buffer;
  kind: 'video' | 'photo';
  mimeType: string | null;
  /** What the QR encodes (the /q/<code> redirect). */
  qrUrl: string;
  /** The words under the QR. */
  label: string;
}

export interface BurnOutput {
  bytes: Buffer;
  contentType: string;
  extension: string;
}

export type CtaBurner = (input: BurnInput) => Promise<BurnOutput>;

const photoFormat = (mimeType: string | null): { contentType: string; extension: string } =>
  mimeType === 'image/jpeg'
    ? { contentType: 'image/jpeg', extension: 'jpg' }
    : { contentType: 'image/png', extension: 'png' };

/** The real burner (ffmpeg). Throws CtaBurnError with a short reason when it cannot. */
export const burnCtaIntoSpot: CtaBurner = async (input) => {
  const ffmpeg = env.FFMPEG_PATH;
  if (!ffmpeg) throw new CtaBurnError('FFMPEG_UNAVAILABLE');
  const probed = await probeMedia(input.bytes).catch(() => {
    throw new CtaBurnError('SPOT_UNREADABLE');
  });
  if (probed.width === null || probed.height === null) throw new CtaBurnError('SPOT_UNREADABLE');
  const geometry = ctaGeometry(probed.width, probed.height, input.kind);
  // Below ~4 px a module a phone camera cannot read the code off a TV: refuse rather than air it.
  if (geometry.qr < CTA_MIN_QR_PX) throw new CtaBurnError('SPOT_TOO_SMALL');
  const out =
    input.kind === 'video'
      ? { contentType: 'video/mp4', extension: 'mp4' }
      : photoFormat(input.mimeType);

  const dir = await mkdtemp(join(tmpdir(), 'toodooh-cta-'));
  try {
    const source = join(dir, 'source');
    const qr = join(dir, 'qr.png');
    const label = join(dir, 'label.txt');
    const output = join(dir, `out.${out.extension}`);
    await writeFile(source, input.bytes);
    await writeFile(label, input.label, 'utf8');
    await writeFile(
      qr,
      await QRCode.toBuffer(input.qrUrl, {
        errorCorrectionLevel: 'M',
        margin: 0,
        width: geometry.qr,
        color: { dark: '#000000', light: '#ffffff' },
      }),
    );
    const graph = ctaFilterGraph(geometry, env.CTA_FONT_PATH ?? CTA_FONT_DEFAULT, label);
    const args =
      input.kind === 'video'
        ? [
            '-v',
            'error',
            '-y',
            '-i',
            source,
            '-i',
            qr,
            '-filter_complex',
            `${graph};[out]format=yuv420p[v]`,
            '-map',
            '[v]',
            '-map',
            '0:a?',
            '-c:v',
            'libx264',
            '-preset',
            'veryfast',
            '-crf',
            '20',
            '-c:a',
            'copy',
            '-movflags',
            '+faststart',
            output,
          ]
        : [
            '-v',
            'error',
            '-y',
            '-i',
            source,
            '-i',
            qr,
            '-filter_complex',
            graph,
            '-map',
            '[out]',
            '-frames:v',
            '1',
            output,
          ];
    try {
      await execFileAsync(ffmpeg, args, { timeout: BURN_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 });
    } catch (err) {
      const stderr =
        typeof err === 'object' && err !== null && 'stderr' in err ? String(err.stderr) : '';
      throw new CtaBurnError(`FFMPEG_FAILED ${stderr.slice(-300)}`.trim());
    }
    return { bytes: await readFile(output), ...out };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};
