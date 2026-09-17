import { readFileSync } from 'node:fs';
import { chmod, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  MAX_CONCURRENT_WEBP_CONVERSIONS,
  MAX_QUEUED_WEBP_CONVERSIONS,
  MAX_WEBP_PIXELS,
  WebpConversionError,
  convertWebpToPng,
  isAnimatedWebp,
  isWebpConversionEnabled,
  isWebpWithinPixelBudget,
  webpDimensions,
} from '../src/lib/webp-to-png.js';

import { jpegBytes, minimalPng, vp8xWebpBytes, webpBytes } from './helpers/media-bytes.js';
import {
  vp8Chunk,
  vp8lChunk,
  vp8lWebpBytes,
  vp8xChunk,
  webpChunk,
  webpContainer,
} from './helpers/webp-bytes.js';

// UPL-4 (operator 2026-09-17) — a WebP PHOTO is converted to PNG on upload. This file needs NO
// ffmpeg: the animation check is pure bytes, and the child-process handling is driven by tiny
// shell stand-ins pointed at through the FFMPEG_PATH env seam (a Proxy, the
// report-recommendations posture). The real binary is exercised by webp-to-png-ffmpeg.test.ts,
// which only runs where FFMPEG_PATH is set.

const envState = vi.hoisted(() => ({ ffmpeg: undefined as string | undefined }));
vi.mock('../src/env.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/env.js')>();
  return {
    ...actual,
    env: new Proxy(actual.env, {
      get: (target, prop) => (prop === 'FFMPEG_PATH' ? envState.ffmpeg : Reflect.get(target, prop)),
    }),
  };
});

const fixture = (name: string): Buffer => readFileSync(join(import.meta.dirname, 'fixtures', name));

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
// The same eight bytes as POSIX printf octal escapes, for the shell stand-ins.
const PRINTF_PNG_MAGIC = String.raw`\211PNG\r\n\032\n`;

describe('isAnimatedWebp — the VP8X animation flag (pure bytes)', () => {
  it('an animated WebP (VP8X, flag 0x02) is animated — built bytes and a real PIL file', () => {
    expect(isAnimatedWebp(vp8xWebpBytes(0x02))).toBe(true);
    expect(isAnimatedWebp(vp8xWebpBytes(0x12))).toBe(true); // animation + alpha
    expect(isAnimatedWebp(fixture('animated.webp'))).toBe(true);
  });

  it('a static lossy (VP8) WebP is not animated', () => {
    expect(fixture('photo.webp').toString('latin1', 12, 16)).toBe('VP8 ');
    expect(isAnimatedWebp(fixture('photo.webp'))).toBe(false);
  });

  it('a static lossless (VP8L) WebP is not animated', () => {
    expect(isAnimatedWebp(webpBytes())).toBe(false);
  });

  it('an extended (VP8X) WebP WITHOUT the animation flag is not animated (alpha only / none)', () => {
    expect(isAnimatedWebp(vp8xWebpBytes(0x10))).toBe(false);
    expect(isAnimatedWebp(vp8xWebpBytes(0x00))).toBe(false);
  });

  it('non-WebP bytes are never animated WebP', () => {
    expect(isAnimatedWebp(minimalPng())).toBe(false);
    expect(isAnimatedWebp(jpegBytes())).toBe(false);
    expect(isAnimatedWebp(Buffer.alloc(64, 0x02))).toBe(false);
  });

  it('a buffer too short to carry the flags byte is not animated', () => {
    const animated = vp8xWebpBytes(0x02);
    expect(isAnimatedWebp(animated.subarray(0, 20))).toBe(false); // flags byte is offset 20
    expect(isAnimatedWebp(animated.subarray(0, 21))).toBe(true);
    expect(isAnimatedWebp(Buffer.alloc(0))).toBe(false);
  });
});

// UPL-4 review (2026-09-17) — a 38-byte lossless WebP can DECLARE 8192×8192 (or 16000×16000):
// ffmpeg then needs 1 GB (or 2-4 GB) to decode it, measured in the prod image. The declared size
// is therefore read from the headers BEFORE anything is spawned, and every way the headers could
// understate what ffmpeg decodes is refused (measured too: ffmpeg decodes the BITSTREAM size when
// the VP8X canvas lies, and goes on decoding a second RIFF appended after a small photo).
describe('webpDimensions — the size a still WebP declares, read without decoding', () => {
  const huge = fixture('huge-8192.webp');
  const alph = webpChunk('ALPH', Buffer.alloc(6, 0));
  const iccp = webpChunk('ICCP', Buffer.alloc(3, 0x11));

  it('lossy (VP8, simple format): width/height at offsets 26/28, low 14 bits', () => {
    expect(webpDimensions(fixture('photo.webp'))).toEqual({ width: 320, height: 180 });
    expect(webpDimensions(webpContainer([vp8Chunk(640, 360)]))).toEqual({
      width: 640,
      height: 360,
    });
    // The top two bits are the (ignored) upscale factors, never part of the size.
    expect(webpDimensions(webpContainer([vp8Chunk(640 | 0xc000, 360 | 0x4000)]))).toEqual({
      width: 640,
      height: 360,
    });
    expect(webpDimensions(webpContainer([vp8Chunk(16383, 16383)]))).toEqual({
      width: 16383,
      height: 16383,
    });
  });

  it('lossless (VP8L, simple format): 14-bit width-1 / height-1 packed after the 0x2F signature', () => {
    expect(webpDimensions(webpBytes())).toEqual({ width: 1, height: 1 });
    expect(webpDimensions(vp8lWebpBytes(300, 7))).toEqual({ width: 300, height: 7 });
    expect(webpDimensions(vp8lWebpBytes(16384, 16384))).toEqual({ width: 16384, height: 16384 });
    // The review's measured bomb: 38 bytes on disk, 8192×8192 declared.
    expect(huge.length).toBe(38);
    expect(webpDimensions(huge)).toEqual({ width: 8192, height: 8192 });
  });

  it('extended (VP8X): the 24-bit canvas at 24..29 must agree with the image bitstream', () => {
    expect(
      webpDimensions(webpContainer([vp8xChunk(0x10, 300, 200), alph, vp8Chunk(300, 200)])),
    ).toEqual({ width: 300, height: 200 });
    expect(
      webpDimensions(webpContainer([vp8xChunk(0x20, 64, 48), iccp, vp8lChunk(64, 48)])),
    ).toEqual({ width: 64, height: 48 });
    const vp8x = webpContainer([vp8xChunk(0x00, 4096, 2), vp8lChunk(4096, 2)]);
    expect(vp8x.readUIntLE(24, 3)).toBe(4095);
    expect(vp8x.readUIntLE(27, 3)).toBe(1);
    expect(webpDimensions(vp8x)).toEqual({ width: 4096, height: 2 });
  });

  it('a VP8X canvas that disagrees with the bitstream is unreadable (ffmpeg decodes the bitstream)', () => {
    expect(webpDimensions(webpContainer([vp8xChunk(0, 16, 16), huge.subarray(12)]))).toBeNull();
    expect(webpDimensions(webpContainer([vp8xChunk(0, 8192, 8192), vp8lChunk(16, 16)]))).toBeNull();
    expect(webpDimensions(webpContainer([vp8xChunk(0, 300, 200), vp8Chunk(300, 201)]))).toBeNull();
  });

  it('anything but ONE container holding ONE image is unreadable', () => {
    // A bomb appended after a small real photo — ffmpeg goes on decoding it.
    expect(webpDimensions(Buffer.concat([fixture('photo.webp'), huge]))).toBeNull();
    expect(webpDimensions(Buffer.concat([vp8lWebpBytes(4, 4), Buffer.alloc(1)]))).toBeNull();
    // Two image chunks, or none at all (a VP8X alone, an animation's ANIM/ANMF frames).
    expect(webpDimensions(webpContainer([vp8lChunk(4, 4), vp8lChunk(4, 4)]))).toBeNull();
    expect(webpDimensions(webpContainer([vp8Chunk(4, 4), vp8lChunk(8192, 8192)]))).toBeNull();
    expect(webpDimensions(webpContainer([vp8xChunk(0, 4, 4)]))).toBeNull();
    expect(webpDimensions(webpContainer([iccp]))).toBeNull();
    expect(webpDimensions(fixture('animated.webp'))).toBeNull();
    expect(webpDimensions(vp8xWebpBytes(0x02))).toBeNull();
    // VP8X is only ever the FIRST chunk, and only once.
    expect(webpDimensions(webpContainer([vp8lChunk(4, 4), vp8xChunk(0, 4, 4)]))).toBeNull();
    expect(
      webpDimensions(webpContainer([vp8xChunk(0, 4, 4), vp8xChunk(0, 4, 4), vp8lChunk(4, 4)])),
    ).toBeNull();
  });

  it('a RIFF size or chunk size that does not match the bytes is unreadable', () => {
    const good = vp8lWebpBytes(4, 4, Buffer.alloc(3));
    const riffTooBig = Buffer.from(good);
    riffTooBig.writeUInt32LE(good.readUInt32LE(4) + 2, 4);
    expect(webpDimensions(riffTooBig)).toBeNull();
    const riffTooSmall = Buffer.from(good);
    riffTooSmall.writeUInt32LE(good.readUInt32LE(4) - 2, 4);
    expect(webpDimensions(riffTooSmall)).toBeNull();
    const chunkOverrun = Buffer.from(good);
    chunkOverrun.writeUInt32LE(good.readUInt32LE(16) + 4, 16);
    expect(webpDimensions(chunkOverrun)).toBeNull();
    // An odd-sized chunk (9 bytes) is readable WITH its pad byte, unreadable without it.
    const oddChunk = vp8lChunk(4, 4, Buffer.alloc(4));
    expect([oddChunk.readUInt32LE(4), oddChunk.length]).toEqual([9, 18]);
    expect(webpDimensions(webpContainer([oddChunk]))).toEqual({ width: 4, height: 4 });
    expect(webpDimensions(webpContainer([oddChunk.subarray(0, 17)]))).toBeNull();
  });

  it('a malformed image header is unreadable', () => {
    expect(webpDimensions(webpContainer([vp8Chunk(64, 64, { keyFrame: false })]))).toBeNull();
    expect(
      webpDimensions(webpContainer([vp8Chunk(64, 64, { startCode: [0x9d, 0x01, 0x2b] })])),
    ).toBeNull();
    expect(webpDimensions(webpContainer([vp8Chunk(0, 64)]))).toBeNull();
    expect(webpDimensions(webpContainer([vp8Chunk(64, 0x4000)]))).toBeNull();
    const badSignature = vp8lWebpBytes(4, 4, Buffer.alloc(3));
    badSignature.writeUInt8(0x2e, 20);
    expect(webpDimensions(badSignature)).toBeNull();
    // Headers too short to hold the sizes.
    expect(webpDimensions(webpContainer([webpChunk('VP8 ', Buffer.alloc(9))]))).toBeNull();
    expect(
      webpDimensions(webpContainer([webpChunk('VP8L', Buffer.from([0x2f, 0, 0, 0]))])),
    ).toBeNull();
    expect(
      webpDimensions(webpContainer([webpChunk('VP8X', Buffer.alloc(9)), vp8lChunk(1, 1)])),
    ).toBeNull();
  });

  it('short buffers and non-WebP bytes are unreadable', () => {
    for (let end = 0; end < huge.length; end += 1) {
      expect(webpDimensions(huge.subarray(0, end))).toBeNull();
    }
    expect(webpDimensions(minimalPng())).toBeNull();
    expect(webpDimensions(jpegBytes())).toBeNull();
    expect(webpDimensions(Buffer.alloc(64, 0x2f))).toBeNull();
  });
});

describe('isWebpWithinPixelBudget — at most 4K UHD worth of pixels (3840 × 2160)', () => {
  it('the budget is the 4K UHD pixel count (operator 2026-09-17)', () => {
    expect(MAX_WEBP_PIXELS).toBe(3840 * 2160);
  });

  it('within the budget: 4K either way round, the exact budget as a square, a long strip', () => {
    expect(isWebpWithinPixelBudget(fixture('photo.webp'))).toBe(true);
    expect(isWebpWithinPixelBudget(vp8lWebpBytes(3840, 2160))).toBe(true);
    expect(isWebpWithinPixelBudget(webpContainer([vp8Chunk(2160, 3840)]))).toBe(true);
    expect(2880 * 2880).toBe(MAX_WEBP_PIXELS);
    expect(isWebpWithinPixelBudget(vp8lWebpBytes(2880, 2880))).toBe(true);
    expect(isWebpWithinPixelBudget(vp8lWebpBytes(16384, 506))).toBe(true);
  });

  it('over the budget by a single row or column → refused', () => {
    expect(isWebpWithinPixelBudget(vp8lWebpBytes(2881, 2880))).toBe(false);
    expect(isWebpWithinPixelBudget(vp8lWebpBytes(3840, 2161))).toBe(false);
    expect(isWebpWithinPixelBudget(vp8lWebpBytes(16384, 507))).toBe(false);
    // 8K UHD (the first budget, 33.2 MP) is now over it.
    expect(isWebpWithinPixelBudget(vp8lWebpBytes(7680, 4320))).toBe(false);
    expect(isWebpWithinPixelBudget(fixture('huge-8192.webp'))).toBe(false);
    expect(isWebpWithinPixelBudget(vp8lWebpBytes(16000, 16000))).toBe(false);
    expect(
      isWebpWithinPixelBudget(webpContainer([vp8xChunk(0, 16384, 16384), vp8lChunk(16384, 16384)])),
    ).toBe(false);
  });

  it('unreadable headers are never within the budget', () => {
    expect(
      isWebpWithinPixelBudget(Buffer.concat([fixture('photo.webp'), fixture('huge-8192.webp')])),
    ).toBe(false);
    expect(isWebpWithinPixelBudget(fixture('animated.webp'))).toBe(false);
    expect(isWebpWithinPixelBudget(minimalPng())).toBe(false);
  });

  it('an explicit budget is honoured to the pixel', () => {
    expect(isWebpWithinPixelBudget(vp8lWebpBytes(100, 100), 10_000)).toBe(true);
    expect(isWebpWithinPixelBudget(vp8lWebpBytes(100, 100), 9_999)).toBe(false);
  });
});

describe('isWebpConversionEnabled — follows FFMPEG_PATH', () => {
  it('off when FFMPEG_PATH is unset, on when it is set', () => {
    envState.ffmpeg = undefined;
    expect(isWebpConversionEnabled()).toBe(false);
    envState.ffmpeg = '/usr/bin/ffmpeg';
    expect(isWebpConversionEnabled()).toBe(true);
  });
});

describe('convertWebpToPng — child-process handling (shell stand-ins for ffmpeg)', () => {
  let dir: string;

  /** Write an executable /bin/sh stand-in and point FFMPEG_PATH at it. */
  const standIn = async (name: string, body: string): Promise<string> => {
    const path = join(dir, name);
    await writeFile(path, `#!/bin/sh\n${body}\n`);
    await chmod(path, 0o755);
    envState.ffmpeg = path;
    return path;
  };

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'toodooh-webp-standin-'));
  });

  beforeEach(() => {
    envState.ffmpeg = undefined;
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('refuses to run when FFMPEG_PATH is not configured', async () => {
    await expect(convertWebpToPng(webpBytes())).rejects.toBeInstanceOf(WebpConversionError);
  });

  it('pipes the bytes through stdin (and ENDS it) with exactly the pinned ffmpeg arguments', async () => {
    const argsOut = join(dir, 'args.txt');
    const stdinOut = join(dir, 'stdin.bin');
    await standIn(
      'record.sh',
      `printf '%s\\n' "$@" > '${argsOut}'\ncat > '${stdinOut}'\nprintf '${PRINTF_PNG_MAGIC}converted'`,
    );
    const input = webpBytes();
    const out = await convertWebpToPng(input);
    expect(out).toEqual(Buffer.concat([PNG_MAGIC, Buffer.from('converted')]));
    expect((await readFile(stdinOut)).equals(input)).toBe(true);
    expect((await readFile(argsOut, 'utf8')).trimEnd().split('\n')).toEqual([
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
    ]);
  });

  it('a non-zero exit rejects with the stderr tail in the message', async () => {
    await standIn('fail.sh', `cat > /dev/null\necho 'image data not found' >&2\nexit 69`);
    const err = await convertWebpToPng(webpBytes()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WebpConversionError);
    expect((err as Error).message).toContain('69');
    expect((err as Error).message).toContain('image data not found');
  });

  it('death by signal rejects', async () => {
    await standIn('signal.sh', 'cat > /dev/null\nkill -9 $$');
    await expect(convertWebpToPng(webpBytes())).rejects.toBeInstanceOf(WebpConversionError);
  });

  it('a clean exit with EMPTY output rejects (the animated-WebP ffmpeg shape)', async () => {
    await standIn('empty.sh', 'cat > /dev/null\nexit 0');
    await expect(convertWebpToPng(webpBytes())).rejects.toBeInstanceOf(WebpConversionError);
  });

  it('a clean exit whose output is not a PNG rejects', async () => {
    await standIn('gif.sh', `cat > /dev/null\nprintf 'GIF89a-not-a-png-at-all'`);
    await expect(convertWebpToPng(webpBytes())).rejects.toBeInstanceOf(WebpConversionError);
  });

  it('a binary that cannot be spawned rejects (no crash)', async () => {
    envState.ffmpeg = join(dir, 'does-not-exist');
    await expect(convertWebpToPng(webpBytes())).rejects.toBeInstanceOf(WebpConversionError);
  });

  it('a child that exits WITHOUT reading stdin (EPIPE on a large input) rejects, the process survives', async () => {
    const ran = join(dir, 'no-read.ran');
    await standIn('no-read.sh', `touch '${ran}'\nexit 3`);
    // 8 MiB of image data inside a well-formed 1×1 header, so the pixel gate lets it through.
    const big = vp8lWebpBytes(1, 1, Buffer.alloc(8 * 1024 * 1024, 0x41));
    expect(isWebpWithinPixelBudget(big)).toBe(true);
    await expect(convertWebpToPng(big)).rejects.toBeInstanceOf(WebpConversionError);
    await expect(readFile(ran)).resolves.toBeDefined();
  });

  it('an over-budget or unreadable WebP is refused BEFORE ffmpeg is spawned', async () => {
    const ran = join(dir, 'gate.ran');
    await standIn('gate.sh', `touch '${ran}'\ncat > /dev/null\nprintf '${PRINTF_PNG_MAGIC}'`);
    for (const bytes of [
      fixture('huge-8192.webp'),
      vp8lWebpBytes(16000, 16000),
      webpContainer([vp8xChunk(0, 16, 16), fixture('huge-8192.webp').subarray(12)]),
      Buffer.concat([fixture('photo.webp'), fixture('huge-8192.webp')]),
      Buffer.from('RIFF\x40\x00\x00\x00WEBPVP8 ', 'latin1'),
    ]) {
      const err = await convertWebpToPng(bytes).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(WebpConversionError);
      expect((err as Error).message).toMatch(/pixel budget|unreadable/i);
    }
    await expect(readFile(ran)).rejects.toThrow();
    // The same stand-in DOES run for an in-budget WebP.
    await expect(convertWebpToPng(vp8lWebpBytes(3840, 2160))).resolves.toEqual(PNG_MAGIC);
    await expect(readFile(ran)).resolves.toBeDefined();
  });

  it('a child that hangs is killed at the timeout and rejects', async () => {
    await standIn('hang.sh', 'exec sleep 30');
    const started = Date.now();
    const err = await convertWebpToPng(webpBytes(), { timeoutMs: 200 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WebpConversionError);
    expect((err as Error).message).toMatch(/timed out/i);
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it('output past the cap is cut at cap + 1 bytes (the caller refuses it as too large)', async () => {
    await standIn(
      'flood.sh',
      `cat > /dev/null\nprintf '${PRINTF_PNG_MAGIC}'\nexec head -c 1000000 /dev/zero`,
    );
    const out = await convertWebpToPng(webpBytes(), { maxBytes: 100 });
    expect(out.length).toBe(101);
    expect(out.subarray(0, 8)).toEqual(PNG_MAGIC);
  });

  it('output within the cap is returned whole', async () => {
    await standIn('fits.sh', `cat > /dev/null\nprintf '${PRINTF_PNG_MAGIC}'\nhead -c 92 /dev/zero`);
    const out = await convertWebpToPng(webpBytes(), { maxBytes: 100 });
    expect(out.length).toBe(100);
  });
});

// UPL-4 review — even in budget, one decode holds real memory (4K UHD fits in 128 MB, measured), so the
// process runs at most MAX_CONCURRENT_WEBP_CONVERSIONS ffmpeg children; a few more conversions
// wait their turn and anything past that is refused at once (the route's WebP refusal).
describe('convertWebpToPng — a process-wide limit on concurrent ffmpeg children', () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'toodooh-webp-gate-'));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  /**
   * A stand-in that records its start in `started/` then holds its slot until `release` exists.
   * Returns the helpers a test needs to observe and release it.
   */
  const blockingStandIn = async (name: string) => {
    const root = await mkdtemp(join(dir, `${name}-`));
    const startedDir = join(root, 'started');
    const releaseFile = join(root, 'release');
    const path = join(root, 'ffmpeg.sh');
    await writeFile(
      path,
      [
        '#!/bin/sh',
        'cat > /dev/null',
        `mkdir -p '${startedDir}'`,
        `touch '${startedDir}/'$$`,
        `while [ ! -e '${releaseFile}' ]; do sleep 0.02; done`,
        `printf '${PRINTF_PNG_MAGIC}'`,
        '',
      ].join('\n'),
    );
    await chmod(path, 0o755);
    envState.ffmpeg = path;
    const started = async (): Promise<number> => (await readdir(startedDir).catch(() => [])).length;
    const waitForStarted = async (count: number): Promise<void> => {
      const deadline = Date.now() + 10_000;
      while ((await started()) < count) {
        if (Date.now() > deadline) throw new Error(`only ${await started()} of ${count} started`);
        await new Promise((r) => setTimeout(r, 20));
      }
    };
    const release = (): Promise<void> => writeFile(releaseFile, '');
    return { started, waitForStarted, release };
  };

  it('never runs more than MAX_CONCURRENT_WEBP_CONVERSIONS children; the others wait, then run', async () => {
    expect(MAX_CONCURRENT_WEBP_CONVERSIONS).toBe(2);
    const gate = await blockingStandIn('limit');
    const total = MAX_CONCURRENT_WEBP_CONVERSIONS + 2;
    const pending = Array.from({ length: total }, () => convertWebpToPng(webpBytes()));
    try {
      await gate.waitForStarted(MAX_CONCURRENT_WEBP_CONVERSIONS);
      // Give a would-be third child ample time to show up: none may.
      await new Promise((r) => setTimeout(r, 400));
      expect(await gate.started()).toBe(MAX_CONCURRENT_WEBP_CONVERSIONS);
    } finally {
      await gate.release();
    }
    const results = await Promise.all(pending);
    expect(results).toEqual(Array.from({ length: total }, () => PNG_MAGIC));
    expect(await gate.started()).toBe(total);
  });

  it('past MAX_QUEUED_WEBP_CONVERSIONS waiting, a conversion is refused at once without spawning', async () => {
    expect(MAX_QUEUED_WEBP_CONVERSIONS).toBe(4);
    const gate = await blockingStandIn('queue');
    const admitted = MAX_CONCURRENT_WEBP_CONVERSIONS + MAX_QUEUED_WEBP_CONVERSIONS;
    const pending = Array.from({ length: admitted }, () => convertWebpToPng(webpBytes()));
    try {
      const err = await convertWebpToPng(webpBytes()).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(WebpConversionError);
      expect((err as Error).message).toMatch(/busy/i);
      await gate.waitForStarted(MAX_CONCURRENT_WEBP_CONVERSIONS);
    } finally {
      await gate.release();
    }
    await expect(Promise.all(pending)).resolves.toHaveLength(admitted);
    expect(await gate.started()).toBe(admitted);
  });

  it('a slot is given back however the child ends (spawn error, failure, timeout)', async () => {
    const failing: Promise<unknown>[] = [];
    for (let i = 0; i < MAX_CONCURRENT_WEBP_CONVERSIONS + MAX_QUEUED_WEBP_CONVERSIONS; i += 1) {
      const kind = i % 3;
      if (kind === 0) envState.ffmpeg = join(dir, 'missing-binary');
      if (kind === 1) {
        const path = join(dir, 'exit3.sh');
        await writeFile(path, '#!/bin/sh\ncat > /dev/null\nexit 3\n');
        await chmod(path, 0o755);
        envState.ffmpeg = path;
      }
      if (kind === 2) {
        const path = join(dir, 'hang.sh');
        await writeFile(path, '#!/bin/sh\nexec sleep 30\n');
        await chmod(path, 0o755);
        envState.ffmpeg = path;
      }
      failing.push(
        convertWebpToPng(webpBytes(), { timeoutMs: 150 }).then(
          () => 'resolved',
          (e: unknown) => e,
        ),
      );
    }
    for (const outcome of await Promise.all(failing)) {
      expect(outcome).toBeInstanceOf(WebpConversionError);
    }
    // Every slot is free again: a full house of new conversions is admitted and completes.
    const gate = await blockingStandIn('after');
    const admitted = MAX_CONCURRENT_WEBP_CONVERSIONS + MAX_QUEUED_WEBP_CONVERSIONS;
    const pending = Array.from({ length: admitted }, () => convertWebpToPng(webpBytes()));
    await gate.release();
    await expect(Promise.all(pending)).resolves.toHaveLength(admitted);
  });
});
