import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { afterAll, describe, expect, it } from 'vitest';

import { probeMedia } from '../src/lib/media-probe.js';
import { closeReportBrowser, resolveChromiumPath } from '../src/lib/report/render.js';
import { burnCtaIntoSpot } from '../src/lib/spot-cta-burn.js';
import { ctaLayout } from '../src/lib/spot-cta-layout.js';

// QR-CTA2 — the burn with the REAL ffmpeg + chromium (skipped where FFMPEG_PATH / FFPROBE_PATH /
// a chromium are missing, like the WebP conversion's own run). A video keeps its size, length and
// codec, shows NO card before 2 s and the white QR tile mid-spot; a photo becomes a 1920×1080
// H.264 video of its diffusion length; a spot too small for a readable QR is refused.

const run = promisify(execFile);
const ffmpeg = process.env['FFMPEG_PATH'];
const enabled = Boolean(ffmpeg && process.env['FFPROBE_PATH'] && resolveChromiumPath());

/** The mean luma of a small box in the frame at `seconds` (grey 8-bit, 0–255). */
async function meanLuma(
  file: string,
  seconds: number,
  box: { x: number; y: number; w: number; h: number },
): Promise<number> {
  const { stdout } = await run(
    ffmpeg ?? '',
    [
      '-v',
      'error',
      '-ss',
      String(seconds),
      '-i',
      file,
      '-frames:v',
      '1',
      '-vf',
      `crop=${box.w}:${box.h}:${box.x}:${box.y},format=gray`,
      '-f',
      'rawvideo',
      '-',
    ],
    { encoding: 'buffer', maxBuffer: 16 * 1024 * 1024 },
  );
  const bytes = stdout as Buffer;
  let sum = 0;
  for (const b of bytes) sum += b;
  return sum / bytes.length;
}

describe.skipIf(!enabled)('QR-CTA2 — burning the QR card with ffmpeg + chromium', () => {
  afterAll(async () => {
    await closeReportBrowser();
  });

  it('a 1080p video keeps its size and length; the card shows from 2 s to the end − 2 s', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cta-test-'));
    try {
      const src = join(dir, 'src.mp4');
      // A black 12 s spot: the white QR tile is unmistakable when it is there.
      await run(ffmpeg ?? '', [
        '-v',
        'error',
        '-y',
        '-f',
        'lavfi',
        '-i',
        'color=c=black:size=1920x1080:rate=25:duration=12',
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        src,
      ]);
      const out = await burnCtaIntoSpot({
        bytes: await readFile(src),
        kind: 'video',
        mimeType: 'video/mp4',
        qrUrl: 'https://too-dooh.com/q/abcd2345',
        label: 'pour en savoir plus',
        durationSeconds: 12,
      });
      expect(out).toMatchObject({ contentType: 'video/mp4', extension: 'mp4' });
      const probed = await probeMedia(out.bytes);
      expect(probed).toMatchObject({ codec: 'h264', width: 1920, height: 1080 });
      expect(Math.round(probed.durationSeconds ?? 0)).toBe(12);

      const file = join(dir, 'out.mp4');
      await writeFile(file, out.bytes);
      // The tile's white margin (left edge, inside the tile, outside the QR).
      const t = ctaLayout(1080).tile;
      const margin = { x: t.x + 4, y: t.y + t.size / 2, w: 6, h: 6 };
      expect(await meanLuma(file, 1, margin)).toBeLessThan(30); // before 2 s: black
      expect(await meanLuma(file, 6, margin)).toBeGreaterThan(220); // mid-spot: the white tile
      expect(await meanLuma(file, 11, margin)).toBeLessThan(30); // after 10 s: gone
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 180_000);

  it('a photo becomes a 1920×1080 H.264 video of its diffusion length', async () => {
    const out = await burnCtaIntoSpot({
      bytes: await readFile('tests/fixtures/photo.png'),
      kind: 'photo',
      mimeType: 'image/png',
      qrUrl: 'https://too-dooh.com/q/abcd2345',
      label: 'Promo du jour',
      durationSeconds: 10,
    });
    expect(out).toMatchObject({ contentType: 'video/mp4', extension: 'mp4' });
    const probed = await probeMedia(out.bytes);
    expect(probed).toMatchObject({ codec: 'h264', width: 1920, height: 1080 });
    expect(Math.round(probed.durationSeconds ?? 0)).toBe(10);
  }, 180_000);

  it('a video too small for a readable QR is refused', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cta-test-'));
    try {
      const src = join(dir, 'tiny.mp4');
      await run(ffmpeg ?? '', [
        '-v',
        'error',
        '-y',
        '-f',
        'lavfi',
        '-i',
        'color=c=black:size=320x180:rate=25:duration=10',
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        src,
      ]);
      await expect(
        burnCtaIntoSpot({
          bytes: await readFile(src),
          kind: 'video',
          mimeType: 'video/mp4',
          qrUrl: 'https://too-dooh.com/q/abcd2345',
          label: 'pour en savoir plus',
          durationSeconds: 10,
        }),
      ).rejects.toThrow('SPOT_TOO_SMALL');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
