import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { sniffContainer } from '../src/lib/media-probe.js';
import {
  WebpConversionError,
  convertWebpToPng,
  isWebpWithinPixelBudget,
} from '../src/lib/webp-to-png.js';

import { vp8lWebpBytes } from './helpers/webp-bytes.js';

// UPL-4 — the REAL ffmpeg conversion. Runs ONLY where an explicit FFMPEG_PATH exists (the docker
// image sets /usr/bin/ffmpeg; a dev machine can point it at a WebP-capable build) — the
// CHROMIUM_PATH / FFPROBE_PATH posture: CI without ffmpeg skips it. webp-to-png.test.ts pins the
// process handling everywhere with shell stand-ins.

const fixture = (name: string): Buffer => readFileSync(join(import.meta.dirname, 'fixtures', name));

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// A docker-wrapped ffmpeg pays a container start per call — generous, but bounded.
const REAL_FFMPEG_TIMEOUT_MS = 30_000;

describe.skipIf(!process.env['FFMPEG_PATH'])('convertWebpToPng — real ffmpeg', () => {
  it(
    'a static WebP photo converts to a PNG',
    async () => {
      const png = await convertWebpToPng(fixture('photo.webp'));
      expect(png.subarray(0, 8)).toEqual(PNG_MAGIC);
      expect(sniffContainer(png)).toBe('png');
      // IHDR carries the source dimensions (the fixture is 320×180).
      expect(png.toString('latin1', 12, 16)).toBe('IHDR');
      expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([320, 180]);
    },
    REAL_FFMPEG_TIMEOUT_MS,
  );

  // The pixel gate refuses an animation (no top-level image chunk) before ffmpeg is spawned; the
  // lane measured ffmpeg 8.0.1 refusing it too (exit 69, empty stdout). Either way: the error.
  it(
    'an ANIMATED WebP → WebpConversionError',
    async () => {
      await expect(convertWebpToPng(fixture('animated.webp'))).rejects.toBeInstanceOf(
        WebpConversionError,
      );
    },
    REAL_FFMPEG_TIMEOUT_MS,
  );

  it(
    'garbage image data behind a well-formed header → ffmpeg fails → WebpConversionError',
    async () => {
      // A 16×16 lossless header passes the pixel gate, so ffmpeg itself sees the garbage (measured:
      // « max symbol 664 > alphabet size 256 », exit 69).
      const garbage = vp8lWebpBytes(16, 16, Buffer.alloc(64, 0x5a));
      expect(isWebpWithinPixelBudget(garbage)).toBe(true);
      const err = await convertWebpToPng(garbage).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(WebpConversionError);
      expect((err as Error).message).toMatch(/exited with code/);
    },
    REAL_FFMPEG_TIMEOUT_MS,
  );
});
