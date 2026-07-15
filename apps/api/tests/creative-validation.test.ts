import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import { type NewUser, campaigns, creatives, users } from '../src/db/schema.js';
import { campaignsRoutes } from '../src/routes/campaigns.js';
import { creativesRoutes } from '../src/routes/creatives.js';
import { storage } from '../src/storage/s3-storage.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// CF-SH1 (spec §1.6) — upload hardening. Real Postgres + real MinIO, session mocked (the
// creatives.test.ts harness). Fixtures are tiny ffmpeg-generated media (tests/fixtures, <200KB
// each). Byte-sniffing tests run EVERYWHERE; the measured codec/ratio/duration tests are gated on
// FFPROBE_PATH (the chromium-smoke posture) and are exercised for real inside the docker image.
// No business_sectors/zones fixtures anywhere (the exact-seed-count footgun).

type GetSessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;

const buildApp = () => Fastify({ logger: false });

const mockSession = (userId: string, role = 'advertiser', status = 'approved'): void => {
  vi.spyOn(auth.api, 'getSession').mockResolvedValue({
    session: {},
    user: { id: userId, role, status },
  } as unknown as GetSessionResult);
};

let seq = 0;
const seedUser = async (values: Partial<NewUser> = {}): Promise<string> => {
  seq += 1;
  const [u] = await db
    .insert(users)
    .values({
      email: `mediaval${seq}@example.com`,
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

const upload = (
  app: ReturnType<typeof buildApp>,
  query: string,
  file: { filename: string; contentType: string; content: Buffer },
) => app.inject({ method: 'POST', url: `/api/creatives?${query}`, ...multipartBody(file) });

describe('creative upload hardening (CF-SH1 — real Postgres + MinIO)', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    await resetAuthTables();
    app = buildApp();
    await app.register(creativesRoutes);
    await app.register(campaignsRoutes);
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

  // ── spec-strict declared types (webm/webp are out for NEW uploads) ───────────
  it('rejects a DECLARED video/webm upload (400 — no longer an accepted type)', async () => {
    mockSession(await seedUser());
    const res = await upload(app, 'type=video&duration_seconds=10', {
      filename: 'clip.webm',
      contentType: 'video/webm',
      content: fixture('vp8-169.webm'),
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toBe('INVALID_INPUT');
    expect(await db.$count(creatives)).toBe(0);
  });

  it('rejects a DECLARED image/webp upload (400 — no longer an accepted type)', async () => {
    mockSession(await seedUser());
    const res = await upload(app, 'type=photo&duration_seconds=10', {
      filename: 'shot.webp',
      contentType: 'image/webp',
      content: fixture('photo.webp'),
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toBe('INVALID_INPUT');
  });

  // ── byte-sniffing: the declared type can no longer lie (every environment) ───
  it('rejects JPEG bytes declared as video/mp4 (400 MEDIA_TYPE_MISMATCH)', async () => {
    mockSession(await seedUser());
    const res = await upload(app, 'type=video&duration_seconds=10', {
      filename: 'clip.mp4',
      contentType: 'video/mp4',
      content: fixture('photo.jpg'),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      error: 'MEDIA_TYPE_MISMATCH',
      declared: 'video/mp4',
      detected: 'jpeg',
    });
    expect(await db.$count(creatives)).toBe(0);
  });

  it('rejects WEBM bytes smuggled as video/mp4 (400 MEDIA_TYPE_MISMATCH, detected webm)', async () => {
    mockSession(await seedUser());
    const res = await upload(app, 'type=video&duration_seconds=10', {
      filename: 'clip.mp4',
      contentType: 'video/mp4',
      content: fixture('vp8-169.webm'),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'MEDIA_TYPE_MISMATCH', detected: 'webm' });
  });

  it('rejects unrecognizable bytes declared as image/jpeg (400 MEDIA_TYPE_MISMATCH)', async () => {
    mockSession(await seedUser());
    const res = await upload(app, 'type=photo&duration_seconds=10', {
      filename: 'shot.jpg',
      contentType: 'image/jpeg',
      content: Buffer.from('definitely-not-a-jpeg'),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'MEDIA_TYPE_MISMATCH', detected: null });
  });

  // ── conforming images still pass (jpeg/png) ──────────────────────────────────
  it('accepts a real JPEG (201) and a real PNG (201)', async () => {
    mockSession(await seedUser());
    const jpeg = await upload(app, 'type=photo&duration_seconds=10', {
      filename: 'shot.jpg',
      contentType: 'image/jpeg',
      content: fixture('photo.jpg'),
    });
    expect(jpeg.statusCode).toBe(201);
    const png = await upload(app, 'type=photo&duration_seconds=20', {
      filename: 'shot.png',
      contentType: 'image/png',
      content: fixture('photo.png'),
    });
    expect(png.statusCode).toBe(201);
    expect((png.json() as { duration_seconds: number }).duration_seconds).toBe(20);
  });

  // ── grandfathering: pre-existing rows are untouched by the new rules ─────────
  it('a PRE-EXISTING webm creative still links to a campaign and still presigns', async () => {
    const me = await seedUser();
    // A row exactly as the pre-CF-SH1 upload route would have written it (webm was accepted).
    const [legacy] = await db
      .insert(creatives)
      .values({
        advertiserId: me,
        creativeType: 'video',
        storageKey: `creatives/${me}/legacy-webm-${seq}`,
        durationSeconds: 12,
        validationStatus: 'approved',
        mimeType: 'video/webm',
        originalFilename: 'legacy.webm',
      })
      .returning();
    await storage.upload({
      key: legacy?.storageKey ?? '',
      body: fixture('vp8-169.webm'),
      contentType: 'video/webm',
    });
    const [campaign] = await db
      .insert(campaigns)
      .values({ advertiserId: me, name: 'Grandfather', campaignType: 'standard' })
      .returning();
    mockSession(me);

    // Linking (PATCH creative_id) applies NO media re-validation…
    const link = await app.inject({
      method: 'PATCH',
      url: `/api/campaigns/${campaign?.id}`,
      payload: { creative_id: legacy?.id },
    });
    expect(link.statusCode).toBe(200);
    expect((link.json() as { creative_id: string }).creative_id).toBe(legacy?.id);

    // …and the stored object still presigns for viewing.
    const url = await app.inject({ method: 'GET', url: `/api/creatives/${legacy?.id}/url` });
    expect(url.statusCode).toBe(200);
    expect((url.json() as { url: string }).url).toContain(legacy?.storageKey ?? '');

    const [row] = await db
      .select()
      .from(creatives)
      .where(eq(creatives.id, legacy?.id ?? ''));
    expect(row?.mimeType).toBe('video/webm'); // untouched — no retro-validation anywhere
  });

  // ── FFPROBE_PATH unset (dev): probe checks SKIP, sniffing still applied ──────
  it.skipIf(process.env['FFPROBE_PATH'])(
    'without ffprobe: a too-long-but-well-formed mp4 passes with the client duration (the designed degradation)',
    async () => {
      mockSession(await seedUser());
      const res = await upload(app, 'type=video&duration_seconds=20', {
        filename: 'long.mp4',
        contentType: 'video/mp4',
        content: fixture('h264-169-35s.mp4'),
      });
      expect(res.statusCode).toBe(201);
      expect((res.json() as { duration_seconds: number }).duration_seconds).toBe(20);
    },
  );

  // ── measured validation (real ffprobe — runs inside the docker image) ────────
  describe.skipIf(!process.env['FFPROBE_PATH'])('ffprobe-measured rules', () => {
    it('accepts a valid H.264 16:9 mp4 — the SERVER-measured duration is stored (client lies 25 → 2)', async () => {
      mockSession(await seedUser());
      const res = await upload(app, 'type=video&duration_seconds=25', {
        filename: 'clip.mp4',
        contentType: 'video/mp4',
        content: fixture('h264-169.mp4'),
      });
      expect(res.statusCode).toBe(201);
      expect((res.json() as { duration_seconds: number }).duration_seconds).toBe(2);
    });

    it('accepts a valid H.264 16:9 MOV (201)', async () => {
      mockSession(await seedUser());
      const res = await upload(app, 'type=video&duration_seconds=2', {
        filename: 'clip.mov',
        contentType: 'video/quicktime',
        content: fixture('h264-169.mov'),
      });
      expect(res.statusCode).toBe(201);
    });

    it('rejects a non-H.264 codec in an mp4 container (400 MEDIA_FORMAT_UNSUPPORTED)', async () => {
      mockSession(await seedUser());
      const res = await upload(app, 'type=video&duration_seconds=2', {
        filename: 'clip.mp4',
        contentType: 'video/mp4',
        content: fixture('mpeg4-169.mp4'),
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({
        error: 'MEDIA_FORMAT_UNSUPPORTED',
        measured_codec: 'mpeg4',
      });
    });

    it('rejects a 4:3 video with the MEASURED ratio in the body (400 MEDIA_RATIO_INVALID)', async () => {
      mockSession(await seedUser());
      const res = await upload(app, 'type=video&duration_seconds=2', {
        filename: 'clip.mp4',
        contentType: 'video/mp4',
        content: fixture('h264-43.mp4'),
      });
      expect(res.statusCode).toBe(400);
      const body = res.json() as { error: string; measured_ratio: number; message: string };
      expect(body.error).toBe('MEDIA_RATIO_INVALID');
      expect(body.measured_ratio).toBeCloseTo(320 / 240, 2);
      expect(body.message).toContain('1.333');
    });

    it('rejects an over-30s video by MEASURED duration — the client param lies (400 MEDIA_DURATION_INVALID)', async () => {
      mockSession(await seedUser());
      const res = await upload(app, 'type=video&duration_seconds=20', {
        filename: 'long.mp4',
        contentType: 'video/mp4',
        content: fixture('h264-169-35s.mp4'),
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({
        error: 'MEDIA_DURATION_INVALID',
        measured_duration_seconds: 35,
      });
      expect(await db.$count(creatives)).toBe(0);
    });
  });
});
