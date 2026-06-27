import { eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import { type NewUser, creatives, users } from '../src/db/schema.js';
import { creativesRoutes } from '../src/routes/creatives.js';
import { apiRoutes } from '../src/routes/index.js';
import { storage } from '../src/storage/s3-storage.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// Integration suite — real Postgres (DATABASE_URL) AND real MinIO (STORAGE_*). getSession is mocked
// to drive the session identity; the StorageProvider is real except the explicit failure-path test
// (spied). resetAuthTables TRUNCATE ... CASCADE wipes creatives via the advertiser_id FK.
type GetSessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;

const buildApp = () => Fastify({ logger: false });

const mockSession = (userId: string, role = 'advertiser', status = 'approved'): void => {
  vi.spyOn(auth.api, 'getSession').mockResolvedValue({
    session: {},
    user: { id: userId, role, status },
  } as unknown as GetSessionResult);
};

const mockNoSession = (): void => {
  vi.spyOn(auth.api, 'getSession').mockResolvedValue(null as unknown as GetSessionResult);
};

// Dependency-free multipart body (single `file` part; scalars ride the querystring).
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

const videoFile = () =>
  multipartBody({
    filename: 'clip.mp4',
    contentType: 'video/mp4',
    content: Buffer.from('fake-mp4-bytes'),
  });
const photoFile = () =>
  multipartBody({
    filename: 'shot.jpg',
    contentType: 'image/jpeg',
    content: Buffer.from('fake-jpeg-bytes'),
  });

let seq = 0;
const seedUser = async (values: Partial<NewUser> = {}): Promise<string> => {
  seq += 1;
  const [u] = await db
    .insert(users)
    .values({
      email: `creative${seq}@example.com`,
      contactName: `User ${seq}`,
      role: 'advertiser',
      status: 'approved',
      ...values,
    })
    .returning();
  return u?.id ?? '';
};

describe('creatives upload + library (advertiser, real Postgres + MinIO)', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    await resetAuthTables();
    app = buildApp();
    await app.register(creativesRoutes);
    await app.ready();
  });

  afterEach(async () => {
    // Rows still exist here (truncate runs in the NEXT beforeEach) — sweep their MinIO objects.
    const rows = await db.select({ key: creatives.storageKey }).from(creatives);
    for (const r of rows) await storage.delete({ key: r.key }).catch(() => undefined);
    await app.close();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await sql.end();
  });

  // ── POST /api/creatives (video) ──────────────────────────────────────────────
  it('uploads a ≤30s video (201; type=video, status=pending, duration persisted)', async () => {
    const me = await seedUser();
    mockSession(me);
    const res = await app.inject({
      method: 'POST',
      url: '/api/creatives?type=video&duration_seconds=25&title=Promo',
      ...videoFile(),
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as Record<string, unknown>;
    expect(body).toMatchObject({
      creative_type: 'video',
      duration_seconds: 25,
      validation_status: 'pending',
      title: 'Promo',
    });
    expect(body['id']).toBeDefined();
    const [row] = await db
      .select()
      .from(creatives)
      .where(eq(creatives.id, body['id'] as string))
      .limit(1);
    expect(row?.advertiserId).toBe(me);
    expect(row?.storageKey).toBe(`creatives/${me}/${body['id'] as string}`);
  });

  it('rejects a video longer than 30s (400)', async () => {
    const me = await seedUser();
    mockSession(me);
    const res = await app.inject({
      method: 'POST',
      url: '/api/creatives?type=video&duration_seconds=31',
      ...videoFile(),
    });
    expect(res.statusCode).toBe(400);
    expect(await db.$count(creatives)).toBe(0);
  });

  // ── POST /api/creatives (photo) ──────────────────────────────────────────────
  it.each([10, 20, 30])(
    'uploads a photo with a valid diffusion duration of %ds (201)',
    async (d) => {
      const me = await seedUser();
      mockSession(me);
      const res = await app.inject({
        method: 'POST',
        url: `/api/creatives?type=photo&duration_seconds=${d}`,
        ...photoFile(),
      });
      expect(res.statusCode).toBe(201);
      expect(
        (res.json() as { creative_type: string; duration_seconds: number }).creative_type,
      ).toBe('photo');
      expect((res.json() as { duration_seconds: number }).duration_seconds).toBe(d);
    },
  );

  it('rejects a photo with a non-slot duration (400)', async () => {
    const me = await seedUser();
    mockSession(me);
    const res = await app.inject({
      method: 'POST',
      url: '/api/creatives?type=photo&duration_seconds=15',
      ...photoFile(),
    });
    expect(res.statusCode).toBe(400);
    expect(await db.$count(creatives)).toBe(0);
  });

  // ── validation guards ────────────────────────────────────────────────────────
  it('rejects a MIME that does not match the asserted type (photo bytes for a video) (400)', async () => {
    const me = await seedUser();
    mockSession(me);
    const res = await app.inject({
      method: 'POST',
      url: '/api/creatives?type=video&duration_seconds=20',
      ...photoFile(),
    });
    expect(res.statusCode).toBe(400);
    expect(await db.$count(creatives)).toBe(0);
  });

  it('rejects a missing/invalid type (400)', async () => {
    const me = await seedUser();
    mockSession(me);
    const res = await app.inject({
      method: 'POST',
      url: '/api/creatives?duration_seconds=20',
      ...videoFile(),
    });
    expect(res.statusCode).toBe(400);
  });

  it('requires authentication (401)', async () => {
    mockNoSession();
    const res = await app.inject({
      method: 'POST',
      url: '/api/creatives?type=video&duration_seconds=20',
      ...videoFile(),
    });
    expect(res.statusCode).toBe(401);
  });

  it('forbids a non-advertiser (403)', async () => {
    const owner = await seedUser({ role: 'individual_owner' });
    mockSession(owner, 'individual_owner');
    const res = await app.inject({
      method: 'POST',
      url: '/api/creatives?type=video&duration_seconds=20',
      ...videoFile(),
    });
    expect(res.statusCode).toBe(403);
  });

  it('writes NO row when storage fails (502, no orphan)', async () => {
    const me = await seedUser();
    mockSession(me);
    vi.spyOn(storage, 'upload').mockResolvedValue({ error: 'disk full' });
    const res = await app.inject({
      method: 'POST',
      url: '/api/creatives?type=video&duration_seconds=20',
      ...videoFile(),
    });
    expect(res.statusCode).toBe(502);
    expect(await db.$count(creatives)).toBe(0);
  });

  // ── reads (owner-scoped) ─────────────────────────────────────────────────────
  it('GET /mine lists only the caller’s creatives', async () => {
    const me = await seedUser();
    const other = await seedUser();
    mockSession(me);
    await app.inject({
      method: 'POST',
      url: '/api/creatives?type=video&duration_seconds=10',
      ...videoFile(),
    });
    await app.inject({
      method: 'POST',
      url: '/api/creatives?type=photo&duration_seconds=20',
      ...photoFile(),
    });
    await db
      .insert(creatives)
      .values({
        advertiserId: other,
        creativeType: 'video',
        storageKey: `creatives/${other}/x`,
        durationSeconds: 10,
      });

    const res = await app.inject({ method: 'GET', url: '/api/creatives/mine' });
    expect(res.statusCode).toBe(200);
    expect((res.json() as unknown[]).length).toBe(2);
  });

  it('GET /:id returns own (200) and 404s a foreign creative (owner-scope)', async () => {
    const me = await seedUser();
    const other = await seedUser();
    const [foreign] = await db
      .insert(creatives)
      .values({
        advertiserId: other,
        creativeType: 'video',
        storageKey: `creatives/${other}/f`,
        durationSeconds: 10,
      })
      .returning();
    mockSession(me);
    const own = await app.inject({
      method: 'POST',
      url: '/api/creatives?type=photo&duration_seconds=10',
      ...photoFile(),
    });
    const ownId = (own.json() as { id: string }).id;

    expect((await app.inject({ method: 'GET', url: `/api/creatives/${ownId}` })).statusCode).toBe(
      200,
    );
    expect(
      (await app.inject({ method: 'GET', url: `/api/creatives/${foreign?.id}` })).statusCode,
    ).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/api/creatives/not-a-uuid' })).statusCode).toBe(
      400,
    );
  });

  it('GET /:id/url presigns an owned creative (200) and 404s a foreign one', async () => {
    const me = await seedUser();
    const other = await seedUser();
    const [foreign] = await db
      .insert(creatives)
      .values({
        advertiserId: other,
        creativeType: 'video',
        storageKey: `creatives/${other}/g`,
        durationSeconds: 10,
      })
      .returning();
    mockSession(me);
    const own = await app.inject({
      method: 'POST',
      url: '/api/creatives?type=video&duration_seconds=10',
      ...videoFile(),
    });
    const ownId = (own.json() as { id: string }).id;

    const url = await app.inject({ method: 'GET', url: `/api/creatives/${ownId}/url` });
    expect(url.statusCode).toBe(200);
    expect((url.json() as { url: string }).url).toContain('http');
    expect(
      (await app.inject({ method: 'GET', url: `/api/creatives/${foreign?.id}/url` })).statusCode,
    ).toBe(404);
  });

  // ── apiRoutes wiring ─────────────────────────────────────────────────────────
  it('is wired into the apiRoutes aggregate (reachable through the full app)', async () => {
    const me = await seedUser();
    mockSession(me);
    const aggregate = buildApp();
    await aggregate.register(apiRoutes);
    await aggregate.ready();
    try {
      const res = await aggregate.inject({ method: 'GET', url: '/api/creatives/mine' });
      expect(res.statusCode).toBe(200);
    } finally {
      await aggregate.close();
    }
  });
});
