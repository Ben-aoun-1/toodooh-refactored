import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import { type NewUser, creatives, users } from '../src/db/schema.js';
import { MediaProbeError, type ProbedMedia } from '../src/lib/media-probe.js';
import { creativesRoutes } from '../src/routes/creatives.js';
import { storage } from '../src/storage/s3-storage.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// UPL-1 (operator 2026-09-16) — the measured VIDEO rules at the route, in EVERY environment. The
// real-ffprobe block of creative-validation.test.ts only runs where FFPROBE_PATH exists (the
// docker image); here the probe module is mocked (probe ON, measurements scripted) so the rules
// that remain — H.264, a readable stream, a measured duration ≤ 30 s, the 15 s event cap — and
// the one that went away — the 16:9 ±2 % ratio — are pinned on every machine. The container is a
// real MP4 (tests/fixtures) so the byte sniff passes; only the stream measurement is scripted.

const probeSpy = vi.hoisted(() => vi.fn<(bytes: Buffer) => Promise<ProbedMedia>>());
vi.mock('../src/lib/media-probe.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/media-probe.js')>();
  return { ...actual, isMediaProbeEnabled: () => true, probeMedia: probeSpy };
});

type GetSessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;

const buildApp = () => Fastify({ logger: false });

const mockSession = (userId: string): void => {
  vi.spyOn(auth.api, 'getSession').mockResolvedValue({
    session: {},
    user: { id: userId, role: 'advertiser', status: 'approved' },
  } as unknown as GetSessionResult);
};

let seq = 0;
const seedUser = async (values: Partial<NewUser> = {}): Promise<string> => {
  seq += 1;
  const [u] = await db
    .insert(users)
    .values({
      email: `probe-rules${seq}@example.com`,
      contactName: `User ${seq}`,
      role: 'advertiser',
      status: 'approved',
      ...values,
    })
    .returning();
  return u?.id ?? '';
};

const fixture = (name: string): Buffer => readFileSync(join(import.meta.dirname, 'fixtures', name));

const multipartBody = (file: { filename: string; contentType: string; content: Buffer }) => {
  const boundary = `----toodoohtest${Date.now()}${Math.random().toString(16).slice(2)}`;
  const head = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${file.filename}"\r\n` +
      `Content-Type: ${file.contentType}\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    payload: Buffer.concat([head, file.content, tail]),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
};

const uploadVideo = (app: ReturnType<typeof buildApp>, query: string) =>
  app.inject({
    method: 'POST',
    url: `/api/creatives?type=video&${query}`,
    ...multipartBody({
      filename: 'spot.mp4',
      contentType: 'video/mp4',
      content: fixture('h264-169.mp4'),
    }),
  });

/** A scripted ffprobe measurement — defaults: a 1080×1920 (portrait) H.264 stream of 15 s. */
const measured = (over: Partial<ProbedMedia> = {}): ProbedMedia => ({
  codec: 'h264',
  durationSeconds: 15,
  width: 1080,
  height: 1920,
  ...over,
});

describe('measured video rules at the upload route (probe mocked — every environment)', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    await resetAuthTables();
    probeSpy.mockReset();
    app = buildApp();
    await app.register(creativesRoutes);
    await app.ready();
  });

  afterEach(async () => {
    const rows = await db.select({ key: creatives.storageKey }).from(creatives);
    for (const r of rows) await storage.delete({ key: r.key }).catch(() => undefined);
    await app.close();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await sql.end();
  });

  // ── UPL-1 — no aspect-ratio limit ────────────────────────────────────────────
  it('accepts a 1080×1920 H.264 15 s video (201) — the MEASURED duration is stored', async () => {
    mockSession(await seedUser());
    probeSpy.mockResolvedValue(measured());
    const res = await uploadVideo(app, 'duration_seconds=10');
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      creative_type: 'video',
      duration_seconds: 15,
      mime_type: 'video/mp4',
      validation_status: 'pending',
    });
    expect(probeSpy).toHaveBeenCalledTimes(1);
    expect(await db.$count(creatives)).toBe(1);
  });

  it.each([
    ['4:3', 1440, 1080],
    ['1:1', 1080, 1080],
    ['21:9', 2560, 1080],
    ['9:16', 720, 1280],
    ['16:9', 1920, 1080],
  ])('accepts a %s H.264 video (%i×%i) — any ratio uploads (201)', async (_ratio, w, h) => {
    mockSession(await seedUser());
    probeSpy.mockResolvedValue(measured({ width: w, height: h, durationSeconds: 8.2 }));
    const res = await uploadVideo(app, 'duration_seconds=8');
    expect(res.statusCode).toBe(201);
    expect((res.json() as { duration_seconds: number }).duration_seconds).toBe(9); // ceil(8.2)
  });

  it('accepts a stream whose dimensions could not be measured — only codec + duration gate (201)', async () => {
    mockSession(await seedUser());
    probeSpy.mockResolvedValue(measured({ width: null, height: null }));
    const res = await uploadVideo(app, 'duration_seconds=15');
    expect(res.statusCode).toBe(201);
  });

  // ── the rules that stay ──────────────────────────────────────────────────────
  it('still requires H.264: an HEVC portrait video → 400 MEDIA_FORMAT_UNSUPPORTED, nothing stored', async () => {
    mockSession(await seedUser());
    const put = vi.spyOn(storage, 'upload');
    probeSpy.mockResolvedValue(measured({ codec: 'hevc' }));
    const res = await uploadVideo(app, 'duration_seconds=15');
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      error: 'MEDIA_FORMAT_UNSUPPORTED',
      measured_codec: 'hevc',
    });
    expect(put).not.toHaveBeenCalled();
    expect(await db.$count(creatives)).toBe(0);
  });

  it('still requires a video stream: no codec measured → 400 MEDIA_FORMAT_UNSUPPORTED', async () => {
    mockSession(await seedUser());
    probeSpy.mockResolvedValue(measured({ codec: null, width: null, height: null }));
    const res = await uploadVideo(app, 'duration_seconds=15');
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'MEDIA_FORMAT_UNSUPPORTED', measured_codec: null });
  });

  it.each([
    [30.4, 31],
    [45, 45],
  ])(
    'still caps the MEASURED duration: %s s → 400 MEDIA_DURATION_INVALID (measured %i), whatever the client said',
    async (seconds, ceiled) => {
      mockSession(await seedUser());
      probeSpy.mockResolvedValue(measured({ durationSeconds: seconds }));
      const res = await uploadVideo(app, 'duration_seconds=20');
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({
        error: 'MEDIA_DURATION_INVALID',
        measured_duration_seconds: ceiled,
      });
      expect(await db.$count(creatives)).toBe(0);
    },
  );

  it('a measured 30.0 s is exactly on the cap (201, stored 30)', async () => {
    mockSession(await seedUser());
    probeSpy.mockResolvedValue(measured({ durationSeconds: 30 }));
    const res = await uploadVideo(app, 'duration_seconds=12');
    expect(res.statusCode).toBe(201);
    expect((res.json() as { duration_seconds: number }).duration_seconds).toBe(30);
  });

  it('an unmeasurable duration → 400 MEDIA_UNREADABLE', async () => {
    mockSession(await seedUser());
    probeSpy.mockResolvedValue(measured({ durationSeconds: null }));
    const res = await uploadVideo(app, 'duration_seconds=15');
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toBe('MEDIA_UNREADABLE');
    expect(await db.$count(creatives)).toBe(0);
  });

  it('an unreadable stream (the probe throws) → 400 MEDIA_UNREADABLE', async () => {
    mockSession(await seedUser());
    probeSpy.mockRejectedValue(new MediaProbeError('moov atom not found'));
    const res = await uploadVideo(app, 'duration_seconds=15');
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toBe('MEDIA_UNREADABLE');
    expect(await db.$count(creatives)).toBe(0);
  });

  it('the event cap still applies to the MEASURED duration: a 20 s portrait spot → 400 EVENT_SPOT_TOO_LONG; 15 s → 201', async () => {
    mockSession(await seedUser());
    probeSpy.mockResolvedValue(measured({ durationSeconds: 20 }));
    const refused = await uploadVideo(app, 'duration_seconds=10&for_event=1');
    expect(refused.statusCode).toBe(400);
    expect((refused.json() as { error: string }).error).toBe('EVENT_SPOT_TOO_LONG');
    expect(await db.$count(creatives)).toBe(0);

    probeSpy.mockResolvedValue(measured({ durationSeconds: 15 }));
    const ok = await uploadVideo(app, 'duration_seconds=10&for_event=1');
    expect(ok.statusCode).toBe(201);
    expect((ok.json() as { duration_seconds: number }).duration_seconds).toBe(15);
  });
});
