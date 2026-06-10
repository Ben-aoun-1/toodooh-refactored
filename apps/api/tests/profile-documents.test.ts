import { eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import { users } from '../src/db/schema.js';
import { profileDocumentsRoutes } from '../src/routes/profile-documents.js';
import { storage } from '../src/storage/s3-storage.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// Integration suite — requires a real Postgres (DATABASE_URL) AND a real MinIO (STORAGE_*).
// The session-guard's getSession is mocked (its own behavior lives in require-auth.test.ts);
// the StorageProvider is real except the explicit failure-path test, which spies on it.
type GetSessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;

const buildApp = () => Fastify({ logger: false });

const mockSession = (userId: string): void => {
  vi.spyOn(auth.api, 'getSession').mockResolvedValue({
    session: {},
    user: { id: userId, role: 'advertiser', status: 'pending' },
  } as unknown as GetSessionResult);
};

// Dependency-free multipart body (form-data not installed; web FormData isn't consumable by
// inject). Single `file` part — the `type` rides in the URL path.
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

describe('POST/GET /api/profile/documents/:type (real Postgres + MinIO)', () => {
  let app: ReturnType<typeof buildApp>;
  let userId: string;

  beforeEach(async () => {
    await resetAuthTables();
    const [u] = await db
      .insert(users)
      .values({ email: 'doc@example.com', contactName: 'Doc Owner' })
      .returning();
    userId = u?.id ?? '';
    app = buildApp();
    await app.register(profileDocumentsRoutes);
    await app.ready();
  });

  afterEach(async () => {
    await storage.delete({ key: `rne/${userId}` }).catch(() => undefined);
    await storage.delete({ key: `cin/${userId}` }).catch(() => undefined);
    await storage.delete({ key: `bank/${userId}` }).catch(() => undefined);
    await app.close();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await sql.end();
  });

  const pdf = Buffer.from('%PDF-1.4 fake rne bytes');
  const post = (type: string, body: ReturnType<typeof multipartBody>) =>
    app.inject({ method: 'POST', url: `/api/profile/documents/${type}`, ...body });
  const get = (type: string) =>
    app.inject({ method: 'GET', url: `/api/profile/documents/${type}` });

  it('POST rne → 200, key stored, object in MinIO', async () => {
    mockSession(userId);
    const res = await post(
      'rne',
      multipartBody({ filename: 'rne.pdf', contentType: 'application/pdf', content: pdf }),
    );
    expect(res.statusCode).toBe(200);
    expect(res.json<{ key: string }>().key).toBe(`rne/${userId}`);
    const [row] = await db.select().from(users).where(eq(users.id, userId));
    expect(row?.registrationDocUrl).toBe(`rne/${userId}`);
    expect('url' in (await storage.getPresignedUrl({ key: `rne/${userId}` }))).toBe(true);
  });

  it('POST cin → 200, key in cin_doc_url', async () => {
    mockSession(userId);
    const res = await post(
      'cin',
      multipartBody({ filename: 'cin.png', contentType: 'image/png', content: pdf }),
    );
    expect(res.statusCode).toBe(200);
    const [row] = await db.select().from(users).where(eq(users.id, userId));
    expect(row?.cinDocUrl).toBe(`cin/${userId}`);
  });

  it('POST bank → 200, key in bank_doc_url; GET bank presigns it', async () => {
    mockSession(userId);
    const res = await post(
      'bank',
      multipartBody({ filename: 'rib.pdf', contentType: 'application/pdf', content: pdf }),
    );
    expect(res.statusCode).toBe(200);
    expect(res.json<{ key: string }>().key).toBe(`bank/${userId}`);
    const [row] = await db.select().from(users).where(eq(users.id, userId));
    expect(row?.bankDocUrl).toBe(`bank/${userId}`);
    const getRes = await get('bank');
    expect(getRes.statusCode).toBe(200);
    const fetched = Buffer.from(
      await (await fetch(getRes.json<{ url: string }>().url)).arrayBuffer(),
    );
    expect(fetched.equals(pdf)).toBe(true);
  });

  it('GET bank with no document → 404', async () => {
    mockSession(userId);
    expect((await get('bank')).statusCode).toBe(404);
  });

  it('GET rne → 200 { url } fetching the uploaded bytes', async () => {
    mockSession(userId);
    await post(
      'rne',
      multipartBody({ filename: 'rne.pdf', contentType: 'application/pdf', content: pdf }),
    );
    const res = await get('rne');
    expect(res.statusCode).toBe(200);
    const fetched = Buffer.from(await (await fetch(res.json<{ url: string }>().url)).arrayBuffer());
    expect(fetched.equals(pdf)).toBe(true);
  });

  it('GET with no document → 404', async () => {
    mockSession(userId);
    expect((await get('cin')).statusCode).toBe(404);
  });

  it('re-upload rne overwrites (same key, new bytes)', async () => {
    mockSession(userId);
    await post(
      'rne',
      multipartBody({ filename: 'a.pdf', contentType: 'application/pdf', content: pdf }),
    );
    const v2 = Buffer.from('%PDF-1.4 SECOND version');
    await post(
      'rne',
      multipartBody({ filename: 'b.pdf', contentType: 'application/pdf', content: v2 }),
    );
    const fetched = Buffer.from(
      await (await fetch((await get('rne')).json<{ url: string }>().url)).arrayBuffer(),
    );
    expect(fetched.equals(v2)).toBe(true);
  });

  it('oversized → 413, column not written', async () => {
    mockSession(userId);
    const big = Buffer.alloc(5 * 1024 * 1024 + 1, 0x41);
    const res = await post(
      'rne',
      multipartBody({ filename: 'big.pdf', contentType: 'application/pdf', content: big }),
    );
    expect(res.statusCode).toBe(413);
    const [row] = await db.select().from(users).where(eq(users.id, userId));
    expect(row?.registrationDocUrl).toBeNull();
  });

  it('bad MIME → 400', async () => {
    mockSession(userId);
    const res = await post(
      'rne',
      multipartBody({ filename: 'x.txt', contentType: 'text/plain', content: Buffer.from('hi') }),
    );
    expect(res.statusCode).toBe(400);
  });

  it('invalid type → 400', async () => {
    mockSession(userId);
    const res = await post(
      'passport',
      multipartBody({ filename: 'x.pdf', contentType: 'application/pdf', content: pdf }),
    );
    expect(res.statusCode).toBe(400);
  });

  it('StorageProvider failure → 502, column not updated', async () => {
    mockSession(userId);
    vi.spyOn(storage, 'upload').mockResolvedValue({ error: 'disk full' });
    const res = await post(
      'rne',
      multipartBody({ filename: 'rne.pdf', contentType: 'application/pdf', content: pdf }),
    );
    expect(res.statusCode).toBe(502);
    const [row] = await db.select().from(users).where(eq(users.id, userId));
    expect(row?.registrationDocUrl).toBeNull();
  });

  it('unauthenticated POST → 401', async () => {
    vi.spyOn(auth.api, 'getSession').mockResolvedValue(null);
    const res = await post(
      'rne',
      multipartBody({ filename: 'rne.pdf', contentType: 'application/pdf', content: pdf }),
    );
    expect(res.statusCode).toBe(401);
  });

  it('unauthenticated GET → 401', async () => {
    vi.spyOn(auth.api, 'getSession').mockResolvedValue(null);
    expect((await get('rne')).statusCode).toBe(401);
  });
});
