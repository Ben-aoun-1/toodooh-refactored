import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

import { probeMedia } from '../src/lib/media-probe.js';
import { burnCtaIntoSpot } from '../src/lib/spot-cta-burn.js';

// QR-CTA1 — the burn with the REAL ffmpeg (skipped where FFMPEG_PATH / FFPROBE_PATH are unset,
// like the WebP conversion's own run). A 1080p spot comes out H.264 at the same size and length; a
// spot too small to carry a readable QR is refused.

const run = promisify(execFile);
const ffmpeg = process.env['FFMPEG_PATH'];
const enabled = Boolean(ffmpeg && process.env['FFPROBE_PATH']);

describe.skipIf(!enabled)('QR-CTA1 — burning the QR with ffmpeg', () => {
  it('a 1080p video keeps its size and length, H.264', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cta-test-'));
    try {
      const src = join(dir, 'src.mp4');
      await run(ffmpeg ?? '', [
        '-v',
        'error',
        '-y',
        '-f',
        'lavfi',
        '-i',
        'testsrc2=size=1920x1080:rate=25:duration=3',
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
        label: 'Pour en savoir plus',
      });
      expect(out.contentType).toBe('video/mp4');
      const probed = await probeMedia(out.bytes);
      expect(probed).toMatchObject({ codec: 'h264', width: 1920, height: 1080 });
      expect(Math.round(probed.durationSeconds ?? 0)).toBe(3);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 120_000);

  it('a spot too small for a readable QR is refused', async () => {
    await expect(
      burnCtaIntoSpot({
        bytes: await readFile('tests/fixtures/photo.png'),
        kind: 'photo',
        mimeType: 'image/png',
        qrUrl: 'https://too-dooh.com/q/abcd2345',
        label: 'Pour en savoir plus',
      }),
    ).rejects.toThrow('SPOT_TOO_SMALL');
  }, 60_000);
});
