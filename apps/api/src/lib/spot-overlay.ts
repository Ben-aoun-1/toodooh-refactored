import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { env } from '../env.js';

// OVL-LIGHT (operator 19/11) — the LIGHT copy of a spot that a TV plays in surimpression (over
// YouTube, a channel, HDMI). The TV decodes it in SOFTWARE so it never takes the hardware decoder
// of the venue's app (single-decoder TVs: a TCL lost YouTube, a Telefunken refused our ad), and a
// software decoder only keeps up with a light stream: 960×540, 25 fps, H.264 Baseline (no
// B-frames, the cheapest profile to decode), ~0.8 Mb/s. Measured 19/11 on a Telefunken (0.9 GB,
// 32-bit): the full 1080p spot played at a low frame rate under software decoding.
//
// No migration: the copy's key is derived from the AIRED source key (the creative, or its QR copy),
// so a new spot or a new QR copy gets a new light copy by construction; which copies exist is
// known from storage (HEAD) and memoised in this process.

const execFileAsync = promisify(execFile);

export const OVERLAY_WIDTH = 960;
export const OVERLAY_HEIGHT = 540;
export const OVERLAY_FPS = 25;
export const OVERLAY_BITRATE_K = 800;
const OVERLAY_TIMEOUT_MS = 3 * 60_000;

/** The light copy's storage key for an aired source key (deterministic). */
export const overlayKeyFor = (airedKey: string): string =>
  `overlays/${createHash('sha256').update(airedKey).digest('hex').slice(0, 32)}.mp4`;

/**
 * The ffmpeg arguments: scaled INTO 960×540 keeping the ratio (padded black — the TV letterboxes
 * anyway), 25 fps constant, no audio (ads air muted), Baseline 3.1, a key frame every 2 s, faststart.
 */
export const overlayFfmpegArgs = (input: string, output: string): string[] => [
  '-y',
  '-i',
  input,
  '-an',
  '-vf',
  `scale=${OVERLAY_WIDTH}:${OVERLAY_HEIGHT}:force_original_aspect_ratio=decrease,` +
    `pad=${OVERLAY_WIDTH}:${OVERLAY_HEIGHT}:(ow-iw)/2:(oh-ih)/2,fps=${OVERLAY_FPS},format=yuv420p`,
  '-c:v',
  'libx264',
  '-profile:v',
  'baseline',
  '-level',
  '3.1',
  '-preset',
  'veryfast',
  '-b:v',
  `${OVERLAY_BITRATE_K}k`,
  '-maxrate',
  `${Math.round(OVERLAY_BITRATE_K * 1.25)}k`,
  '-bufsize',
  `${OVERLAY_BITRATE_K * 2}k`,
  '-g',
  String(OVERLAY_FPS * 2),
  '-movflags',
  '+faststart',
  output,
];

export class OverlayTranscodeError extends Error {}

export type OverlayTranscoder = (source: Buffer) => Promise<Buffer>;

/** The real transcoder (the api image's ffmpeg). */
export const transcodeOverlay: OverlayTranscoder = async (source) => {
  const ffmpeg = env.FFMPEG_PATH;
  if (!ffmpeg) throw new OverlayTranscodeError('FFMPEG_UNAVAILABLE');
  const dir = await mkdtemp(join(tmpdir(), 'ovl-'));
  try {
    const input = join(dir, 'in');
    const output = join(dir, 'out.mp4');
    await writeFile(input, source);
    await execFileAsync(ffmpeg, overlayFfmpegArgs(input, output), {
      timeout: OVERLAY_TIMEOUT_MS,
      maxBuffer: 4 * 1024 * 1024,
    });
    return await readFile(output);
  } catch (err) {
    throw new OverlayTranscodeError(
      err instanceof Error ? err.message.slice(0, 200) : 'transcode failed',
    );
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
};

// ── which light copies exist (this process) ──────────────────────────────────────────────────
const ready = new Set<string>();
const failed = new Set<string>();

export const overlayRegistry = {
  isReady: (overlayKey: string): boolean => ready.has(overlayKey),
  markReady: (overlayKey: string): void => {
    ready.add(overlayKey);
    failed.delete(overlayKey);
  },
  /** A copy that could not be made is not retried in this process (the full spot still airs). */
  markFailed: (overlayKey: string): void => {
    failed.add(overlayKey);
  },
  isFailed: (overlayKey: string): boolean => failed.has(overlayKey),
  /** Tests only. */
  reset: (): void => {
    ready.clear();
    failed.clear();
  },
};
