import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { env } from '../env.js';

const execFileAsync = promisify(execFile);

// CF-SH1 (spec §1.6) — authoritative media validation for NEW creative uploads. Two layers:
//
//   1. BYTE-SNIFFING (always on): magic-byte container detection so a declared mimetype can never
//      lie about what the bytes are. Cheap, dependency-free, runs in every environment.
//   2. FFPROBE (env-gated, the CHROMIUM_PATH posture): codec / dimensions / duration measured from
//      the actual stream. The docker image installs ffmpeg and sets FFPROBE_PATH; a dev machine
//      without it skips these checks (ONE boot warning in server.ts) — never block dev, never
//      silently skip in the real image.
//
// Existing creatives are GRANDFATHERED: nothing here runs anywhere but the upload route — reads,
// linking, moderation and playout of already-stored rows are untouched.

/** Containers the sniffer can recognize. `null` = none of them (unknown bytes). */
export type SniffedContainer = 'mp4' | 'mov' | 'webm' | 'jpeg' | 'png' | 'webp' | 'pdf' | null;

// ISO base-media major brands accepted as "mp4 family". A QuickTime file carries 'qt  '.
const MP4_BRANDS = new Set([
  'isom',
  'iso2',
  'iso4',
  'iso5',
  'iso6',
  'mp41',
  'mp42',
  'avc1',
  'M4V ',
  'M4A ',
  'mp4v',
  'dash',
]);

/** Magic-byte container detection — the declared mimetype is never trusted on its own. */
export function sniffContainer(bytes: Buffer): SniffedContainer {
  if (bytes.length >= 12) {
    // ISO BMFF (mp4/mov): [4-byte size]['ftyp'][4-byte major brand].
    if (bytes.toString('latin1', 4, 8) === 'ftyp') {
      const brand = bytes.toString('latin1', 8, 12);
      if (brand === 'qt  ') return 'mov';
      if (MP4_BRANDS.has(brand)) return 'mp4';
      return null; // an exotic ISO brand is not spec-conforming — treat as unrecognized
    }
    // RIFF....WEBP
    if (bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.toString('latin1', 8, 12) === 'WEBP') {
      return 'webp';
    }
  }
  // EBML (webm/mkv)
  if (bytes.length >= 4 && bytes.readUInt32BE(0) === 0x1a45dfa3) return 'webm';
  // JPEG: FF D8 FF
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'jpeg';
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes.length >= 8 &&
    bytes.readUInt32BE(0) === 0x89504e47 &&
    bytes.readUInt32BE(4) === 0x0d0a1a0a
  ) {
    return 'png';
  }
  // PDF: '%PDF-' (CF-M2 — the recharge justificatif accepts PDFs; creatives never do: UPL-2
  // refuses PDF bytes by the sniffed kind, whatever the declared type).
  if (bytes.length >= 5 && bytes.toString('latin1', 0, 5) === '%PDF-') return 'pdf';
  return null;
}

/** The container(s) each ACCEPTED declared mimetype must sniff as. */
const DECLARED_TO_CONTAINER: Record<string, SniffedContainer> = {
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'image/jpeg': 'jpeg',
  'image/png': 'png',
  'application/pdf': 'pdf',
};

/** True when the declared mimetype and the sniffed bytes agree. */
export function declaredMatchesSniffed(declaredMime: string, sniffed: SniffedContainer): boolean {
  return sniffed !== null && DECLARED_TO_CONTAINER[declaredMime] === sniffed;
}

export const isMediaProbeEnabled = (): boolean => Boolean(env.FFPROBE_PATH);

export interface ProbedMedia {
  codec: string | null;
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
}

/** ffprobe failed to make sense of the bytes (or timed out) — treated as invalid media upstream. */
export class MediaProbeError extends Error {}

// A 50MB-max local file probe is fast; 10s is a generous ceiling before declaring the file hostile.
const PROBE_TIMEOUT_MS = 10_000;

interface FfprobeOutput {
  format?: { duration?: string };
  streams?: { codec_type?: string; codec_name?: string; width?: number; height?: number }[];
}

/**
 * Measure the actual stream via ffprobe (temp file → spawn → JSON), with a hard timeout and
 * temp-file hygiene. Throws MediaProbeError when ffprobe cannot parse the bytes — for an upload
 * that means the file is not what it claims to be.
 */
export async function probeMedia(bytes: Buffer): Promise<ProbedMedia> {
  const ffprobe = env.FFPROBE_PATH;
  if (!ffprobe) throw new MediaProbeError('FFPROBE_PATH is not configured');
  const dir = await mkdtemp(join(tmpdir(), 'toodooh-probe-'));
  const file = join(dir, randomUUID());
  try {
    await writeFile(file, bytes);
    const { stdout } = await execFileAsync(
      ffprobe,
      ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file],
      { timeout: PROBE_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 },
    );
    const parsed = JSON.parse(stdout) as FfprobeOutput;
    const video = parsed.streams?.find((s) => s.codec_type === 'video');
    const duration = parsed.format?.duration ? Number(parsed.format.duration) : null;
    return {
      codec: video?.codec_name ?? null,
      durationSeconds: duration !== null && Number.isFinite(duration) ? duration : null,
      width: video?.width ?? null,
      height: video?.height ?? null,
    };
  } catch (err) {
    if (err instanceof MediaProbeError) throw err;
    const reason = err instanceof Error ? err.message : 'unknown probe failure';
    throw new MediaProbeError(`ffprobe could not read the media: ${reason}`);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

// Spec rules for a VIDEO stream (measured values, not declarations). UPL-1 (operator 2026-09-16):
// NO aspect-ratio rule — any ratio is accepted; the web preview tile and the TV player (resize_mode
// fit) letterbox whatever they are given. The measured width/height above stay informational.
export const REQUIRED_VIDEO_CODEC = 'h264';
