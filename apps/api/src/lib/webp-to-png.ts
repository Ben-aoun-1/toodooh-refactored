import { type ChildProcessByStdio, spawn } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';

import { env } from '../env.js';

import { MAX_CREATIVE_BYTES } from './creatives.js';
import { sniffContainer } from './media-probe.js';

// UPL-4 (operator 2026-09-17) — a WebP PHOTO is converted to PNG on upload. Images saved from the
// web are often WebP whatever their name says (an advertiser's « .png » was refused as WebP), yet
// the TV app, moderation and the reports only ever handle PNG/JPEG. Converting at the door keeps
// it that way: a WebP is never stored, only the PNG it decodes to.
//
// ffmpeg (already in the api image for ffprobe) does the decode, bytes in on stdin, PNG out on
// stdout — no temp file, no shell. Env-gated like the media probe (media-probe.ts): the docker
// image sets FFMPEG_PATH; a machine without it refuses WebP photos exactly as before (ONE boot
// warning in server.ts). An ANIMATED WebP is never converted: ffmpeg's WebP decoder cannot read
// one, and a single frame of an animation is not what the advertiser meant to show.
//
// Decoding is the one step whose MEMORY an uploader controls: a 38-byte lossless WebP can declare
// 8192×8192, and ffmpeg then needs ~1 GB (16000×16000: 2-4 GB) — measured in the prod image
// (UPL-4 review). So the size a WebP declares is read from its headers before anything is spawned
// and capped at 4K UHD worth of pixels, and at most two ffmpeg children run at once.

/** True when FFMPEG_PATH is configured, i.e. a WebP photo is converted rather than refused. */
export const isWebpConversionEnabled = (): boolean => Boolean(env.FFMPEG_PATH);

// Extended-format WebP: « RIFF » size « WEBP », then a « VP8X » chunk whose payload starts with a
// flags byte (file offset 20). Bit 0x02 = the file carries an animation (ANIM/ANMF chunks).
const VP8X_FLAGS_OFFSET = 20;
const VP8X_ANIMATION_FLAG = 0x02;

/** True for a WebP whose VP8X header declares an animation; false for anything else. */
export function isAnimatedWebp(bytes: Buffer): boolean {
  if (bytes.length <= VP8X_FLAGS_OFFSET) return false;
  if (bytes.toString('latin1', 0, 4) !== 'RIFF') return false;
  if (bytes.toString('latin1', 8, 12) !== 'WEBP') return false;
  if (bytes.toString('latin1', 12, 16) !== 'VP8X') return false;
  return (bytes.readUInt8(VP8X_FLAGS_OFFSET) & VP8X_ANIMATION_FLAG) !== 0;
}

/** The width × height a still WebP declares. */
export interface WebpDimensions {
  readonly width: number;
  readonly height: number;
}

const RIFF_HEADER_BYTES = 12; // « RIFF », the container size (LE), « WEBP »
const CHUNK_HEADER_BYTES = 8; // the FourCC, the payload size (LE); odd payloads carry a pad byte

// Chunk payload layouts, offsets inside the payload:
// « VP8  » — a 3-byte frame tag (bit 0 clear = key frame), the start code 9D 01 2A, then width and
//            height as 16-bit LE whose low 14 bits are the size (the top 2 are an upscale hint).
// « VP8L » — the signature 0x2F, then width-1 and height-1 as two 14-bit fields packed LE.
// « VP8X » — flags, 3 reserved bytes, then the canvas width-1 and height-1 as 24-bit LE.
const VP8_MIN_PAYLOAD_BYTES = 10;
const VP8L_MIN_PAYLOAD_BYTES = 5;
const VP8X_PAYLOAD_BYTES = 10;

function vp8Dimensions(payload: Buffer): WebpDimensions | null {
  if (payload.length < VP8_MIN_PAYLOAD_BYTES) return null;
  if ((payload.readUInt8(0) & 0x01) !== 0) return null; // not a key frame: no size to read
  if (payload.readUIntBE(3, 3) !== 0x9d012a) return null;
  const width = payload.readUInt16LE(6) & 0x3fff;
  const height = payload.readUInt16LE(8) & 0x3fff;
  return width > 0 && height > 0 ? { width, height } : null;
}

function vp8lDimensions(payload: Buffer): WebpDimensions | null {
  if (payload.length < VP8L_MIN_PAYLOAD_BYTES || payload.readUInt8(0) !== 0x2f) return null;
  const packed = payload.readUInt32LE(1);
  return { width: (packed & 0x3fff) + 1, height: ((packed >>> 14) & 0x3fff) + 1 };
}

function vp8xCanvas(payload: Buffer): WebpDimensions | null {
  if (payload.length < VP8X_PAYLOAD_BYTES) return null;
  return { width: payload.readUIntLE(4, 3) + 1, height: payload.readUIntLE(7, 3) + 1 };
}

/**
 * The size a still WebP declares, read from its chunk headers without decoding — or null unless
 * the bytes are exactly ONE RIFF/WEBP container (ffmpeg goes on decoding anything appended) whose
 * chunks fit it exactly, holding exactly one VP8/VP8L image and, when there is a VP8X chunk (first
 * only), a canvas equal to that image (ffmpeg allocates the BITSTREAM size whatever VP8X says).
 */
export function webpDimensions(bytes: Buffer): WebpDimensions | null {
  if (bytes.length < RIFF_HEADER_BYTES) return null;
  if (bytes.toString('latin1', 0, 4) !== 'RIFF') return null;
  if (bytes.toString('latin1', 8, 12) !== 'WEBP') return null;
  if (bytes.readUInt32LE(4) + 8 !== bytes.length) return null;

  let canvas: WebpDimensions | null = null;
  let image: WebpDimensions | null = null;
  let offset = RIFF_HEADER_BYTES;
  while (offset < bytes.length) {
    if (offset + CHUNK_HEADER_BYTES > bytes.length) return null;
    const fourCc = bytes.toString('latin1', offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    const start = offset + CHUNK_HEADER_BYTES;
    const next = start + size + (size % 2);
    if (next > bytes.length) return null;
    const payload = bytes.subarray(start, start + size);
    if (fourCc === 'VP8X') {
      if (offset !== RIFF_HEADER_BYTES) return null;
      canvas = vp8xCanvas(payload);
      if (canvas === null) return null;
    } else if (fourCc === 'VP8 ' || fourCc === 'VP8L') {
      if (image !== null) return null;
      image = fourCc === 'VP8L' ? vp8lDimensions(payload) : vp8Dimensions(payload);
      if (image === null) return null;
    }
    offset = next;
  }
  if (image === null) return null;
  if (canvas !== null && (canvas.width !== image.width || canvas.height !== image.height)) {
    return null;
  }
  return image;
}

// 4K UHD worth of pixels (3840 × 2160 = 8.3 MP), in either orientation or any shape — operator
// ruling 2026-09-17 (8K = 33.2 MP needed ~0.5 GB per decode; the api container is capped). Measured
// in the prod image (ffmpeg 8.0.1): a 4K WebP decodes within 128 MB, lossless in ~2 s, a 4.6 MB
// lossy WebP of pure noise (the slowest PNG to encode) in ~10 s — inside the 15 s timeout.
export const MAX_WEBP_PIXELS = 3840 * 2160;

/** True when the WebP's declared size is readable (webpDimensions) and at most `maxPixels`. */
export function isWebpWithinPixelBudget(
  bytes: Buffer,
  maxPixels: number = MAX_WEBP_PIXELS,
): boolean {
  const size = webpDimensions(bytes);
  return size !== null && size.width * size.height <= maxPixels;
}

/** ffmpeg could not turn the bytes into a PNG (or was not allowed to finish). */
export class WebpConversionError extends Error {}

// At most this many ffmpeg children at once, process-wide (each may hold ~128 MB in budget) …
export const MAX_CONCURRENT_WEBP_CONVERSIONS = 2;
// … and at most this many more conversions waiting for a slot; past that one is refused at once.
export const MAX_QUEUED_WEBP_CONVERSIONS = 4;

/** Gives a held conversion slot back. Idempotent. */
type ReleaseSlot = () => void;

let runningConversions = 0;
const waitingConversions: (() => void)[] = [];

function slotRelease(): ReleaseSlot {
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const next = waitingConversions.shift();
    if (next)
      next(); // the slot passes straight to the oldest waiter
    else runningConversions -= 1;
  };
}

/** A slot now, a slot once one frees up (when the queue has room), or null when it is full. */
function acquireSlot(): Promise<ReleaseSlot> | null {
  if (runningConversions < MAX_CONCURRENT_WEBP_CONVERSIONS) {
    runningConversions += 1;
    return Promise.resolve(slotRelease());
  }
  if (waitingConversions.length >= MAX_QUEUED_WEBP_CONVERSIONS) return null;
  return new Promise<ReleaseSlot>((resolve) => {
    waitingConversions.push(() => resolve(slotRelease()));
  });
}

// stdin (a WebP) → the first frame → stdout (a PNG). Alpha is kept (RGBA out).
const FFMPEG_ARGS: readonly string[] = [
  '-hide_banner',
  '-loglevel',
  'error',
  '-f',
  'webp_pipe',
  '-i',
  'pipe:0',
  '-frames:v',
  '1',
  '-c:v',
  'png',
  '-f',
  'image2pipe',
  'pipe:1',
];

// A photo decodes in about a second; past 15 s the input is treated as hostile.
const CONVERSION_TIMEOUT_MS = 15_000;
// Enough of ffmpeg's stderr to say why it failed, never an unbounded buffer.
const STDERR_TAIL_BYTES = 512;

export interface WebpConversionLimits {
  /**
   * The largest acceptable PNG (default MAX_CREATIVE_BYTES). Output is collected up to
   * maxBytes + 1 bytes: a longer PNG is cut there and the child killed, so a result LONGER than
   * maxBytes means « too large » (and is not a whole PNG) — the caller must refuse it.
   */
  maxBytes?: number;
  /** Kill ffmpeg and reject after this long (default 15 s). */
  timeoutMs?: number;
}

/**
 * Convert a static WebP to PNG with ffmpeg. Rejects with WebpConversionError when FFMPEG_PATH is
 * unset, the headers are unreadable or over MAX_WEBP_PIXELS, every slot and queue place is taken,
 * ffmpeg cannot start, exits non-zero or by a signal, times out, prints nothing, or prints
 * something that is not a PNG. Settles exactly once; the child is killed whenever it is not done.
 * The timeout runs from the spawn, not from the wait for a slot.
 */
export async function convertWebpToPng(
  bytes: Buffer,
  limits: WebpConversionLimits = {},
): Promise<Buffer> {
  const ffmpeg = env.FFMPEG_PATH;
  if (!ffmpeg) throw new WebpConversionError('FFMPEG_PATH is not configured');
  if (!isWebpWithinPixelBudget(bytes)) {
    throw new WebpConversionError(
      `WebP headers unreadable or over the pixel budget (${MAX_WEBP_PIXELS} px) — not decoded`,
    );
  }
  const slot = acquireSlot();
  if (slot === null) {
    throw new WebpConversionError(
      `WebP conversion busy: ${MAX_CONCURRENT_WEBP_CONVERSIONS} running, ${MAX_QUEUED_WEBP_CONVERSIONS} waiting`,
    );
  }
  return runFfmpeg(ffmpeg, bytes, limits, await slot);
}

function runFfmpeg(
  ffmpeg: string,
  bytes: Buffer,
  limits: WebpConversionLimits,
  releaseSlot: ReleaseSlot,
): Promise<Buffer> {
  const collectCap = (limits.maxBytes ?? MAX_CREATIVE_BYTES) + 1;
  const timeoutMs = limits.timeoutMs ?? CONVERSION_TIMEOUT_MS;

  return new Promise<Buffer>((resolve, reject) => {
    let proc: ChildProcessByStdio<Writable, Readable, Readable>;
    try {
      proc = spawn(ffmpeg, FFMPEG_ARGS, { stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (err) {
      releaseSlot();
      const reason = err instanceof Error ? err.message : 'unknown spawn failure';
      reject(new WebpConversionError(`ffmpeg could not start: ${reason}`));
      return;
    }
    // The slot is held until the child is GONE, not merely until this promise settles: a killed
    // ffmpeg owns its memory until it exits. 'close' also covers a child that never started.
    proc.once('exit', releaseSlot);
    proc.once('close', releaseSlot);

    const chunks: Buffer[] = [];
    let collected = 0;
    let stderrTail = Buffer.alloc(0);
    let settled = false;
    // Deadline for the whole conversion — fail() kills the child if it is still running.
    const timer = setTimeout(() => fail(`ffmpeg timed out after ${timeoutMs} ms`), timeoutMs);

    const stop = (): boolean => {
      if (settled) return false;
      settled = true;
      clearTimeout(timer);
      if (proc.exitCode === null && proc.signalCode === null) proc.kill('SIGKILL');
      return true;
    };
    const fail = (reason: string): void => {
      if (!stop()) return;
      const detail = stderrTail.toString('utf8').trim();
      reject(new WebpConversionError(detail ? `${reason}: ${detail}` : reason));
    };
    const succeed = (png: Buffer): void => {
      if (sniffContainer(png) !== 'png') {
        fail('ffmpeg output is not a PNG');
        return;
      }
      if (stop()) resolve(png);
    };

    proc.on('error', (err) => fail(`ffmpeg could not run: ${err.message}`));
    proc.on('close', (code, signal) => {
      if (signal !== null) fail(`ffmpeg was killed by ${signal}`);
      else if (code !== 0) fail(`ffmpeg exited with code ${String(code)}`);
      else if (collected === 0) fail('ffmpeg produced no output');
      else succeed(Buffer.concat(chunks, collected));
    });

    proc.stdout.on('data', (chunk: Buffer) => {
      if (settled) return;
      const room = collectCap - collected;
      if (chunk.length < room) {
        chunks.push(chunk);
        collected += chunk.length;
        return;
      }
      // Past the cap: keep exactly cap bytes (the « too large » signal) and stop ffmpeg.
      chunks.push(chunk.subarray(0, room));
      collected += room;
      succeed(Buffer.concat(chunks, collected));
    });

    proc.stderr.on('data', (chunk: Buffer) => {
      const joined = Buffer.concat([stderrTail, chunk]);
      stderrTail = Buffer.from(joined.subarray(Math.max(0, joined.length - STDERR_TAIL_BYTES)));
    });

    // A child that exits without reading all of stdin makes the write fail (EPIPE). That is not
    // a crash: the exit status (or the timeout) decides the outcome.
    proc.stdin.on('error', () => undefined);
    proc.stdin.end(bytes);
  });
}
