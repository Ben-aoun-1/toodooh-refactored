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
import { jpegBytes, minimalPng, pdfBytes, webpBytes } from './helpers/media-bytes.js';

// CF-SH1 (spec §1.6) — upload hardening. Real Postgres + real MinIO, session mocked (the
// creatives.test.ts harness). Fixtures are tiny ffmpeg-generated media (tests/fixtures, <200KB
// each). Byte-sniffing tests run EVERYWHERE; the measured codec/ratio/duration tests are gated on
// FFPROBE_PATH (the chromium-smoke posture) and are exercised for real inside the docker image;
// creative-probe-rules.test.ts pins the same rules everywhere with the probe mocked.
// UPL-2 (operator 2026-09-16) — the SNIFFED bytes decide; the declared type is advisory and never
// stored. No business_sectors/zones fixtures anywhere (the exact-seed-count footgun).
// UPL-4 — WebP-photo conversion is pinned OFF in this file (FFMPEG_PATH unset — the dev/CI
// posture), so the WebP refusals below are the disabled-state contract on every machine, even one
// that exports FFMPEG_PATH. The converting path lives in creative-webp-conversion.test.ts.
vi.mock('../src/lib/webp-to-png.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/webp-to-png.js')>();
  return { ...actual, isWebpConversionEnabled: () => false };
});

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

// `contentType: null` omits the part's Content-Type header (busboy then reports text/plain) —
// the « browser sent no usable type » case.
interface UploadFile {
  filename: string;
  contentType: string | null;
  content: Buffer;
}

const multipartBody = (file: UploadFile) => {
  const boundary = `----toodoohtest${Date.now()}${Math.random().toString(16).slice(2)}`;
  const head = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${file.filename}"\r\n` +
      (file.contentType === null ? '' : `Content-Type: ${file.contentType}\r\n`) +
      '\r\n',
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    payload: Buffer.concat([head, file.content, tail]),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
};

const upload = (app: ReturnType<typeof buildApp>, query: string, file: UploadFile) =>
  app.inject({ method: 'POST', url: `/api/creatives?${query}`, ...multipartBody(file) });

/** The stored row for an upload response — the mime is asserted at the DB, not only the view. */
const storedRow = async (id: string) => {
  const [row] = await db.select().from(creatives).where(eq(creatives.id, id)).limit(1);
  return row;
};

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

  // ── spec-strict kinds (webm/webp are out for NEW uploads — judged on the bytes) ──
  it('refuses a WebM video, declared as such (400 MEDIA_KIND_UNSUPPORTED, detected webm)', async () => {
    mockSession(await seedUser());
    const res = await upload(app, 'type=video&duration_seconds=10', {
      filename: 'clip.webm',
      contentType: 'video/webm',
      content: fixture('vp8-169.webm'),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      error: 'MEDIA_KIND_UNSUPPORTED',
      creative_type: 'video',
      declared: 'video/webm',
      detected: 'webm',
    });
    expect(await db.$count(creatives)).toBe(0);
  });

  it('WebP conversion OFF: refuses a WebP photo, declared as such (400 MEDIA_KIND_UNSUPPORTED, detected webp)', async () => {
    mockSession(await seedUser());
    const res = await upload(app, 'type=photo&duration_seconds=10', {
      filename: 'shot.webp',
      contentType: 'image/webp',
      content: fixture('photo.webp'),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      error: 'MEDIA_KIND_UNSUPPORTED',
      creative_type: 'photo',
      detected: 'webp',
    });
    expect(await db.$count(creatives)).toBe(0);
  });

  // ── byte-sniffing: a declared type can never make bad bytes pass (every environment) ──
  it('refuses a photo (JPEG bytes) uploaded as a video, whatever was declared (400 MEDIA_KIND_UNSUPPORTED)', async () => {
    mockSession(await seedUser());
    const res = await upload(app, 'type=video&duration_seconds=10', {
      filename: 'clip.mp4',
      contentType: 'video/mp4',
      content: fixture('photo.jpg'),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      error: 'MEDIA_KIND_UNSUPPORTED',
      creative_type: 'video',
      declared: 'video/mp4',
      detected: 'jpeg',
    });
    expect(await db.$count(creatives)).toBe(0);
  });

  it('refuses WEBM bytes smuggled as video/mp4 (400 MEDIA_KIND_UNSUPPORTED, detected webm)', async () => {
    mockSession(await seedUser());
    const res = await upload(app, 'type=video&duration_seconds=10', {
      filename: 'clip.mp4',
      contentType: 'video/mp4',
      content: fixture('vp8-169.webm'),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'MEDIA_KIND_UNSUPPORTED', detected: 'webm' });
    expect(await db.$count(creatives)).toBe(0);
  });

  it('refuses unrecognizable bytes declared as image/jpeg (400 MEDIA_TYPE_MISMATCH)', async () => {
    mockSession(await seedUser());
    const res = await upload(app, 'type=photo&duration_seconds=10', {
      filename: 'shot.jpg',
      contentType: 'image/jpeg',
      content: Buffer.from('definitely-not-a-jpeg'),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      error: 'MEDIA_TYPE_MISMATCH',
      creative_type: 'photo',
      declared: 'image/jpeg',
      detected: null,
    });
    expect((res.json() as { message: string }).message).toBe(
      'Format de fichier non reconnu. Envoyez une image PNG ou JPEG.',
    );
  });

  it('refuses unrecognizable bytes declared as video/mp4 (400 MEDIA_TYPE_MISMATCH)', async () => {
    mockSession(await seedUser());
    const res = await upload(app, 'type=video&duration_seconds=10', {
      filename: 'clip.mp4',
      contentType: 'video/mp4',
      content: Buffer.from('definitely-not-an-mp4-at-all'),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      error: 'MEDIA_TYPE_MISMATCH',
      creative_type: 'video',
      detected: null,
    });
    expect(await db.$count(creatives)).toBe(0);
  });

  // ── UPL-2 — the bytes decide the format; the stored mime comes from the bytes ───
  describe('UPL-2 — the format is read from the bytes (prod refused real « .png » photos)', () => {
    it('a real PNG with an UPPER-CASE name, declared image/png → 201, stored image/png', async () => {
      mockSession(await seedUser());
      const put = vi.spyOn(storage, 'upload');
      const res = await upload(app, 'type=photo&duration_seconds=10', {
        filename: 'AFFICHE.PNG',
        contentType: 'image/png',
        content: minimalPng(),
      });
      expect(res.statusCode).toBe(201);
      const body = res.json() as { id: string; mime_type: string; original_filename: string };
      expect(body.mime_type).toBe('image/png');
      expect(body.original_filename).toBe('AFFICHE.PNG');
      expect((await storedRow(body.id))?.mimeType).toBe('image/png');
      expect(put).toHaveBeenCalledWith(expect.objectContaining({ contentType: 'image/png' }));
    });

    it('a real PNG the browser declared application/octet-stream → 201, stored image/png', async () => {
      mockSession(await seedUser());
      const put = vi.spyOn(storage, 'upload');
      const res = await upload(app, 'type=photo&duration_seconds=20', {
        filename: 'photo.png',
        contentType: 'application/octet-stream',
        content: minimalPng(),
      });
      expect(res.statusCode).toBe(201);
      const body = res.json() as { id: string; mime_type: string; duration_seconds: number };
      expect(body.mime_type).toBe('image/png');
      expect(body.duration_seconds).toBe(20);
      expect((await storedRow(body.id))?.mimeType).toBe('image/png');
      expect(put).toHaveBeenCalledWith(expect.objectContaining({ contentType: 'image/png' }));
    });

    it('a real PNG sent with NO part content type (busboy: text/plain) → 201, stored image/png', async () => {
      mockSession(await seedUser());
      const res = await upload(app, 'type=photo&duration_seconds=10', {
        filename: 'photo.png',
        contentType: null,
        content: minimalPng(),
      });
      expect(res.statusCode).toBe(201);
      const body = res.json() as { id: string; mime_type: string };
      expect(body.mime_type).toBe('image/png');
      expect((await storedRow(body.id))?.mimeType).toBe('image/png');
    });

    it('JPEG bytes named .png and declared image/png → 201, stored image/jpeg (never the declared type)', async () => {
      mockSession(await seedUser());
      const put = vi.spyOn(storage, 'upload');
      const res = await upload(app, 'type=photo&duration_seconds=10', {
        filename: 'photo.png',
        contentType: 'image/png',
        content: jpegBytes(),
      });
      expect(res.statusCode).toBe(201);
      const body = res.json() as { id: string; mime_type: string; original_filename: string };
      expect(body.mime_type).toBe('image/jpeg');
      expect(body.original_filename).toBe('photo.png');
      expect((await storedRow(body.id))?.mimeType).toBe('image/jpeg');
      expect(put).toHaveBeenCalledWith(expect.objectContaining({ contentType: 'image/jpeg' }));
    });

    it('WebP conversion OFF: WebP bytes named .png and declared image/png → 400 MEDIA_KIND_UNSUPPORTED (detected webp), nothing stored', async () => {
      mockSession(await seedUser());
      const put = vi.spyOn(storage, 'upload');
      const res = await upload(app, 'type=photo&duration_seconds=10', {
        filename: 'photo.png',
        contentType: 'image/png',
        content: webpBytes(),
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({
        error: 'MEDIA_KIND_UNSUPPORTED',
        creative_type: 'photo',
        declared: 'image/png',
        detected: 'webp',
      });
      expect((res.json() as { message: string }).message).toBe(
        'Ce fichier est au format WebP : il ne peut pas être téléversé comme photo.',
      );
      expect(put).not.toHaveBeenCalled();
      expect(await db.$count(creatives)).toBe(0);
    });

    it('garbage bytes named .png and declared image/png → 400 MEDIA_TYPE_MISMATCH, nothing stored', async () => {
      mockSession(await seedUser());
      const put = vi.spyOn(storage, 'upload');
      const res = await upload(app, 'type=photo&duration_seconds=10', {
        filename: 'photo.png',
        contentType: 'image/png',
        content: Buffer.from('this is not an image, only some text bytes'),
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ error: 'MEDIA_TYPE_MISMATCH', detected: null });
      expect(put).not.toHaveBeenCalled();
      expect(await db.$count(creatives)).toBe(0);
    });

    it('a PNG uploaded as type=video → 400 MEDIA_KIND_UNSUPPORTED (detected png)', async () => {
      mockSession(await seedUser());
      const res = await upload(app, 'type=video&duration_seconds=10', {
        filename: 'photo.png',
        contentType: 'image/png',
        content: minimalPng(),
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({
        error: 'MEDIA_KIND_UNSUPPORTED',
        creative_type: 'video',
        detected: 'png',
      });
      expect((res.json() as { message: string }).message).toBe(
        'Ce fichier est au format PNG : il ne peut pas être téléversé comme vidéo.',
      );
      expect(await db.$count(creatives)).toBe(0);
    });

    it('an MP4 uploaded as type=photo → 400 MEDIA_KIND_UNSUPPORTED (detected mp4)', async () => {
      mockSession(await seedUser());
      const res = await upload(app, 'type=photo&duration_seconds=10', {
        filename: 'clip.mp4',
        contentType: 'video/mp4',
        content: fixture('h264-169.mp4'),
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({
        error: 'MEDIA_KIND_UNSUPPORTED',
        creative_type: 'photo',
        detected: 'mp4',
      });
      expect(await db.$count(creatives)).toBe(0);
    });

    it('PDF bytes declared image/jpeg → 400 MEDIA_KIND_UNSUPPORTED (detected pdf)', async () => {
      mockSession(await seedUser());
      const res = await upload(app, 'type=photo&duration_seconds=10', {
        filename: 'visuel.jpg',
        contentType: 'image/jpeg',
        content: pdfBytes(),
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ error: 'MEDIA_KIND_UNSUPPORTED', detected: 'pdf' });
      expect(await db.$count(creatives)).toBe(0);
    });

    it('an MP4 the browser declared application/octet-stream → 201, stored video/mp4', async () => {
      mockSession(await seedUser());
      const res = await upload(app, 'type=video&duration_seconds=2', {
        filename: 'CLIP.MP4',
        contentType: 'application/octet-stream',
        content: fixture('h264-169.mp4'),
      });
      expect(res.statusCode).toBe(201);
      const body = res.json() as { id: string; mime_type: string };
      expect(body.mime_type).toBe('video/mp4');
      expect((await storedRow(body.id))?.mimeType).toBe('video/mp4');
    });

    it('MOV bytes declared video/mp4 → 201, stored video/quicktime', async () => {
      mockSession(await seedUser());
      const put = vi.spyOn(storage, 'upload');
      const res = await upload(app, 'type=video&duration_seconds=2', {
        filename: 'clip.mp4',
        contentType: 'video/mp4',
        content: fixture('h264-169.mov'),
      });
      expect(res.statusCode).toBe(201);
      const body = res.json() as { id: string; mime_type: string };
      expect(body.mime_type).toBe('video/quicktime');
      expect((await storedRow(body.id))?.mimeType).toBe('video/quicktime');
      expect(put).toHaveBeenCalledWith(expect.objectContaining({ contentType: 'video/quicktime' }));
    });

    it('a request with NO file part is the one INVALID_INPUT file case (400)', async () => {
      mockSession(await seedUser());
      const boundary = `----toodoohtest${Date.now()}`;
      const res = await app.inject({
        method: 'POST',
        url: '/api/creatives?type=photo&duration_seconds=10',
        payload: Buffer.from(`--${boundary}--\r\n`),
        headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({
        error: 'INVALID_INPUT',
        fields: [{ field: 'file', reason: 'a file is required' }],
      });
    });
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
    expect((jpeg.json() as { mime_type: string }).mime_type).toBe('image/jpeg');
    const png = await upload(app, 'type=photo&duration_seconds=20', {
      filename: 'shot.png',
      contentType: 'image/png',
      content: fixture('photo.png'),
    });
    expect(png.statusCode).toBe(201);
    expect((png.json() as { duration_seconds: number }).duration_seconds).toBe(20);
    expect((png.json() as { mime_type: string }).mime_type).toBe('image/png');
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

    it('UPL-1 — accepts a 4:3 H.264 video: there is no aspect-ratio limit (201)', async () => {
      mockSession(await seedUser());
      const res = await upload(app, 'type=video&duration_seconds=2', {
        filename: 'clip.mp4',
        contentType: 'video/mp4',
        content: fixture('h264-43.mp4'),
      });
      expect(res.statusCode).toBe(201);
      expect((res.json() as { mime_type: string }).mime_type).toBe('video/mp4');
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
