import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import { type NewUser, creatives, users } from '../src/db/schema.js';
import { hashCreativeBytes } from '../src/lib/creative-identity.js';
import { MAX_CREATIVE_BYTES } from '../src/lib/creatives.js';
import { WebpConversionError } from '../src/lib/webp-to-png.js';
import { creativesRoutes } from '../src/routes/creatives.js';
import { storage } from '../src/storage/s3-storage.js';

import { resetAuthTables } from './helpers/db-test-setup.js';
import { minimalPng, vp8xWebpBytes, webpBytes } from './helpers/media-bytes.js';
import { vp8lWebpBytes, vp8xChunk, webpContainer } from './helpers/webp-bytes.js';

// UPL-4 (operator 2026-09-17) — an advertiser's « .png » that was really WebP bytes (an image
// saved from the web) was refused. A static WebP PHOTO is now converted to PNG on upload, so only
// PNG/JPEG is ever stored. The converter module is mocked here (conversion switchable, ffmpeg
// scripted) so the route contract is pinned on every machine; the animation check stays REAL.
// Real Postgres + MinIO, session mocked (the creative-validation.test.ts harness).

const conv = vi.hoisted(() => ({
  enabled: vi.fn<() => boolean>(),
  convert: vi.fn<(bytes: Buffer) => Promise<Buffer>>(),
}));
vi.mock('../src/lib/webp-to-png.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/webp-to-png.js')>();
  return { ...actual, isWebpConversionEnabled: conv.enabled, convertWebpToPng: conv.convert };
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
      email: `webp-conv${seq}@example.com`,
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

/** The WebP-refusal body, exactly as UPL-2 sends it (unchanged by UPL-4). */
const webpRefusal = (declared: string) => ({
  error: 'MEDIA_KIND_UNSUPPORTED',
  message: 'Ce fichier est au format WebP : il ne peut pas être téléversé comme photo.',
  creative_type: 'photo',
  declared,
  detected: 'webp',
});

describe('UPL-4 — a WebP photo is converted to PNG on upload (converter mocked)', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    await resetAuthTables();
    conv.enabled.mockReset();
    conv.convert.mockReset();
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

  it('conversion ON + a static WebP named .png → 201; the PNG is what is stored, sized and hashed', async () => {
    mockSession(await seedUser());
    conv.enabled.mockReturnValue(true);
    const converted = minimalPng();
    conv.convert.mockResolvedValue(converted);
    const put = vi.spyOn(storage, 'upload');
    const webp = fixture('photo.webp');

    const res = await upload(app, 'type=photo&duration_seconds=10', {
      filename: 'photo.png',
      contentType: 'image/png',
      content: webp,
    });

    expect(res.statusCode).toBe(201);
    expect(conv.convert).toHaveBeenCalledTimes(1);
    expect(conv.convert.mock.calls[0]?.[0].equals(webp)).toBe(true);
    const body = res.json() as {
      id: string;
      mime_type: string;
      size_bytes: number;
      original_filename: string;
    };
    expect(body.mime_type).toBe('image/png');
    expect(body.size_bytes).toBe(converted.length);
    expect(body.original_filename).toBe('photo.png');

    // The stored object is the PNG, under the PNG content type — never the WebP bytes.
    expect(put).toHaveBeenCalledTimes(1);
    const stored = put.mock.calls[0]?.[0];
    expect(stored?.contentType).toBe('image/png');
    expect(stored?.body.equals(converted)).toBe(true);
    const downloaded = await storage.download({ key: stored?.key ?? '' });
    if ('error' in downloaded) throw new Error(`stored object unreadable: ${downloaded.error}`);
    expect(downloaded.body.equals(converted)).toBe(true);
    expect(downloaded.contentType).toBe('image/png');

    const [row] = await db.select().from(creatives).where(eq(creatives.id, body.id)).limit(1);
    expect(row?.mimeType).toBe('image/png');
    expect(row?.sizeBytes).toBe(converted.length);
    // The identity hash is taken on the STORED bytes (moderators approve what is stored).
    expect(row?.fileHash).toBe(hashCreativeBytes(converted));
    expect(row?.fileHash).not.toBe(hashCreativeBytes(webp));
    expect(row?.originalFilename).toBe('photo.png');
  });

  it('conversion ON + a WebP declared image/webp → 201, stored image/png', async () => {
    mockSession(await seedUser());
    conv.enabled.mockReturnValue(true);
    conv.convert.mockResolvedValue(minimalPng());
    const res = await upload(app, 'type=photo&duration_seconds=20', {
      filename: 'shot.webp',
      contentType: 'image/webp',
      content: webpBytes(),
    });
    expect(res.statusCode).toBe(201);
    expect((res.json() as { mime_type: string }).mime_type).toBe('image/png');
    expect((res.json() as { duration_seconds: number }).duration_seconds).toBe(20);
  });

  it('conversion ON + an ANIMATED WebP → the UPL-2 refusal, converter never called, nothing stored', async () => {
    mockSession(await seedUser());
    conv.enabled.mockReturnValue(true);
    const put = vi.spyOn(storage, 'upload');
    for (const content of [fixture('animated.webp'), vp8xWebpBytes(0x02)]) {
      const res = await upload(app, 'type=photo&duration_seconds=10', {
        filename: 'anim.png',
        contentType: 'image/png',
        content,
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toStrictEqual(webpRefusal('image/png'));
    }
    expect(conv.convert).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
    expect(await db.$count(creatives)).toBe(0);
  });

  // UPL-4 review — a 38-byte WebP can declare 8192×8192 and make ffmpeg hold ~1 GB: the declared
  // size is checked from the headers BEFORE the converter is called (budget: 4K UHD, 3840×2160).
  it('conversion ON + a WebP declaring more pixels than 4K UHD → the UPL-2 refusal, converter never called, nothing stored', async () => {
    mockSession(await seedUser());
    conv.enabled.mockReturnValue(true);
    conv.convert.mockResolvedValue(minimalPng());
    const put = vi.spyOn(storage, 'upload');
    const huge = fixture('huge-8192.webp');
    expect(huge.length).toBe(38);
    for (const content of [
      huge,
      // The same bitstream behind a VP8X canvas that claims 16×16.
      webpContainer([vp8xChunk(0, 16, 16), huge.subarray(12)]),
      // The same file appended after a small, real photo.
      Buffer.concat([fixture('photo.webp'), huge]),
      vp8lWebpBytes(3841, 2160),
      // 8K UHD — the first budget, now over it.
      vp8lWebpBytes(7680, 4320),
    ]) {
      const res = await upload(app, 'type=photo&duration_seconds=10', {
        filename: 'huge.png',
        contentType: 'image/png',
        content,
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toStrictEqual(webpRefusal('image/png'));
    }
    expect(conv.convert).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
    expect(await db.$count(creatives)).toBe(0);
  });

  it('conversion ON + a 4K UHD WebP (exactly the budget) is converted', async () => {
    mockSession(await seedUser());
    conv.enabled.mockReturnValue(true);
    conv.convert.mockResolvedValue(minimalPng());
    const res = await upload(app, 'type=photo&duration_seconds=10', {
      filename: 'uhd.webp',
      contentType: 'image/webp',
      content: vp8lWebpBytes(3840, 2160),
    });
    expect(res.statusCode).toBe(201);
    expect(conv.convert).toHaveBeenCalledTimes(1);
    expect((res.json() as { mime_type: string }).mime_type).toBe('image/png');
  });

  it('conversion ON + the converter fails → the UPL-2 refusal, nothing stored', async () => {
    mockSession(await seedUser());
    conv.enabled.mockReturnValue(true);
    conv.convert.mockRejectedValue(new WebpConversionError('ffmpeg exited with code 69'));
    const put = vi.spyOn(storage, 'upload');
    const res = await upload(app, 'type=photo&duration_seconds=10', {
      filename: 'photo.png',
      contentType: 'image/png',
      content: fixture('photo.webp'),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toStrictEqual(webpRefusal('image/png'));
    expect(conv.convert).toHaveBeenCalledTimes(1);
    expect(put).not.toHaveBeenCalled();
    expect(await db.$count(creatives)).toBe(0);
  });

  it('conversion OFF (FFMPEG_PATH unset) → the UPL-2 refusal, converter never called', async () => {
    mockSession(await seedUser());
    conv.enabled.mockReturnValue(false);
    const put = vi.spyOn(storage, 'upload');
    const res = await upload(app, 'type=photo&duration_seconds=10', {
      filename: 'photo.png',
      contentType: 'image/png',
      content: fixture('photo.webp'),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toStrictEqual(webpRefusal('image/png'));
    expect(conv.convert).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
    expect(await db.$count(creatives)).toBe(0);
  });

  it('a converted PNG over the size cap → 413 PAYLOAD_TOO_LARGE, nothing stored', async () => {
    mockSession(await seedUser());
    conv.enabled.mockReturnValue(true);
    const oversized = Buffer.concat([minimalPng(), Buffer.alloc(MAX_CREATIVE_BYTES)]);
    conv.convert.mockResolvedValue(oversized);
    const put = vi.spyOn(storage, 'upload');
    const res = await upload(app, 'type=photo&duration_seconds=10', {
      filename: 'photo.png',
      contentType: 'image/png',
      content: fixture('photo.webp'),
    });
    expect(res.statusCode).toBe(413);
    expect(res.json()).toStrictEqual({
      error: 'PAYLOAD_TOO_LARGE',
      message: `Le fichier dépasse la limite de ${MAX_CREATIVE_BYTES} octets.`,
    });
    expect(put).not.toHaveBeenCalled();
    expect(await db.$count(creatives)).toBe(0);
  });

  it('a VIDEO upload of WebP bytes stays refused as before — conversion is photo-only', async () => {
    mockSession(await seedUser());
    conv.enabled.mockReturnValue(true);
    conv.convert.mockResolvedValue(minimalPng());
    const res = await upload(app, 'type=video&duration_seconds=10', {
      filename: 'clip.mp4',
      contentType: 'video/mp4',
      content: fixture('photo.webp'),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toStrictEqual({
      error: 'MEDIA_KIND_UNSUPPORTED',
      message: 'Ce fichier est au format WebP : il ne peut pas être téléversé comme vidéo.',
      creative_type: 'video',
      declared: 'video/mp4',
      detected: 'webp',
    });
    expect(conv.convert).not.toHaveBeenCalled();
    expect(await db.$count(creatives)).toBe(0);
  });

  it('JPEG and PNG photos never touch the converter (conversion ON)', async () => {
    mockSession(await seedUser());
    conv.enabled.mockReturnValue(true);
    const png = await upload(app, 'type=photo&duration_seconds=10', {
      filename: 'shot.png',
      contentType: 'image/png',
      content: fixture('photo.png'),
    });
    expect(png.statusCode).toBe(201);
    expect((png.json() as { size_bytes: number }).size_bytes).toBe(fixture('photo.png').length);
    const jpeg = await upload(app, 'type=photo&duration_seconds=10', {
      filename: 'shot.jpg',
      contentType: 'image/jpeg',
      content: fixture('photo.jpg'),
    });
    expect(jpeg.statusCode).toBe(201);
    expect((jpeg.json() as { mime_type: string }).mime_type).toBe('image/jpeg');
    expect(conv.convert).not.toHaveBeenCalled();
  });
});
