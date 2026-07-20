import { randomUUID } from 'node:crypto';

import { and, eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import { type NewUser, recharges, users } from '../src/db/schema.js';
import { MAX_JUSTIFICATIF_BYTES, makeReference } from '../src/lib/recharges.js';
import { adminRechargesRoutes } from '../src/routes/admin-recharges.js';
import { rechargesRoutes } from '../src/routes/recharges.js';
import { storage } from '../src/storage/s3-storage.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// CF-M2 — the recharge justificatif (bank-transfer proof document). Integration suite: real
// Postgres (DATABASE_URL) + real MinIO (STORAGE_*), session mocked (the recharges.test.ts
// harness). Fixtures carry REAL magic bytes — the route byte-sniffs (CF-SH1 posture), so a
// declared mimetype can never lie about what the bytes are.

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

let seq = 0;
const seedUser = async (values: Partial<NewUser> = {}): Promise<string> => {
  seq += 1;
  const [u] = await db
    .insert(users)
    .values({
      email: `rchdoc${seq}@example.com`,
      contactName: `User ${seq}`,
      role: 'advertiser',
      status: 'approved',
      ...values,
    })
    .returning();
  return u?.id ?? '';
};

const seedRecharge = async (
  advertiserId: string,
  status: 'pending' | 'confirmed' | 'rejected' = 'pending',
): Promise<string> => {
  const id = randomUUID();
  await db
    .insert(recharges)
    .values({ id, advertiserId, amountTnd: '150.00', reference: makeReference(id), status });
  return id;
};

// Dependency-free multipart body (the profile-documents.test.ts pattern — form-data not
// installed; web FormData isn't consumable by inject). Single `file` part.
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

// REAL magic bytes per container (the sniffer reads these, not the declared mimetype).
const PDF_BYTES = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n%%EOF\n');
const JPEG_BYTES = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
  Buffer.from('JFIF\0 test jpeg body'),
]);
const PNG_BYTES = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('test png body'),
]);
const WEBP_BYTES = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([0x24, 0x00, 0x00, 0x00]),
  Buffer.from('WEBPVP8 test webp body'),
]);
const EXE_BYTES = Buffer.from('MZ\x90\x00 definitely not a document');

describe('recharge justificatif (advertiser + admin, real Postgres + MinIO)', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    await resetAuthTables();
    app = buildApp();
    await app.register(rechargesRoutes);
    await app.register(adminRechargesRoutes);
    await app.ready();
  });

  afterEach(async () => {
    // Rows still exist here (the truncate runs in the NEXT test's beforeEach) — sweep their
    // MinIO objects so reruns stay clean.
    const rows = await db.select({ key: recharges.documentKey }).from(recharges);
    for (const r of rows) {
      if (r.key !== null) await storage.delete({ key: r.key }).catch(() => undefined);
    }
    await app.close();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await sql.end();
  });

  const upload = (id: string, body: ReturnType<typeof multipartBody>) =>
    app.inject({ method: 'POST', url: `/api/recharges/${id}/document`, ...body });
  const ownerUrl = (id: string) =>
    app.inject({ method: 'GET', url: `/api/recharges/${id}/document-url` });
  const adminUrl = (id: string) =>
    app.inject({ method: 'GET', url: `/api/admin/recharges/${id}/document-url` });
  const pdfBody = (name = 'virement.pdf') =>
    multipartBody({ filename: name, contentType: 'application/pdf', content: PDF_BYTES });

  // ── upload matrix ──────────────────────────────────────────────────────────
  it.each([
    ['application/pdf', 'virement.pdf', PDF_BYTES, 'pdf'],
    ['image/jpeg', 'virement.jpg', JPEG_BYTES, 'jpg'],
    ['image/png', 'virement.png', PNG_BYTES, 'png'],
  ])('accepts %s: stamps the columns and stores the object', async (mime, name, bytes, ext) => {
    const me = await seedUser();
    const id = await seedRecharge(me);
    mockSession(me);
    const res = await upload(
      id,
      multipartBody({ filename: name, contentType: mime, content: bytes }),
    );
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id, status: 'pending', has_document: true });
    const [row] = await db.select().from(recharges).where(eq(recharges.id, id)).limit(1);
    expect(row?.documentKey).toBe(`recharges/${id}/justificatif.${ext}`);
    expect(row?.documentMime).toBe(mime);
    expect(row?.documentUploadedAt).not.toBeNull();
    const stored = await storage.download({ key: `recharges/${id}/justificatif.${ext}` });
    expect('body' in stored && stored.body.equals(bytes)).toBe(true);
  });

  it('rejects a declared webp (mime not accepted) with 400', async () => {
    const me = await seedUser();
    const id = await seedRecharge(me);
    mockSession(me);
    const res = await upload(
      id,
      multipartBody({ filename: 'x.webp', contentType: 'image/webp', content: WEBP_BYTES }),
    );
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'INVALID_INPUT' });
  });

  it('rejects exe bytes declared as pdf with 400 MEDIA_TYPE_MISMATCH', async () => {
    const me = await seedUser();
    const id = await seedRecharge(me);
    mockSession(me);
    const res = await upload(
      id,
      multipartBody({ filename: 'x.pdf', contentType: 'application/pdf', content: EXE_BYTES }),
    );
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'MEDIA_TYPE_MISMATCH', detected: null });
  });

  it('rejects png bytes declared as jpeg with 400 MEDIA_TYPE_MISMATCH (sniffed png)', async () => {
    const me = await seedUser();
    const id = await seedRecharge(me);
    mockSession(me);
    const res = await upload(
      id,
      multipartBody({ filename: 'x.jpg', contentType: 'image/jpeg', content: PNG_BYTES }),
    );
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'MEDIA_TYPE_MISMATCH', detected: 'png' });
    const [row] = await db.select().from(recharges).where(eq(recharges.id, id)).limit(1);
    expect(row?.documentKey).toBeNull();
  });

  it('rejects an oversize file (>10MB) with 413 and stores nothing', async () => {
    const me = await seedUser();
    const id = await seedRecharge(me);
    mockSession(me);
    const big = Buffer.concat([PDF_BYTES, Buffer.alloc(MAX_JUSTIFICATIF_BYTES)]);
    const res = await upload(
      id,
      multipartBody({ filename: 'big.pdf', contentType: 'application/pdf', content: big }),
    );
    expect(res.statusCode).toBe(413);
    const [row] = await db.select().from(recharges).where(eq(recharges.id, id)).limit(1);
    expect(row?.documentKey).toBeNull();
  });

  // ── pending-only ───────────────────────────────────────────────────────────
  it.each(['confirmed', 'rejected'] as const)(
    'refuses an upload on a %s recharge with 409 + currentStatus',
    async (status) => {
      const me = await seedUser();
      const id = await seedRecharge(me, status);
      mockSession(me);
      const res = await upload(id, pdfBody());
      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({ error: 'CONFLICT', currentStatus: status });
    },
  );

  it('404s an upload on a foreign recharge (indistinguishable from missing)', async () => {
    const owner = await seedUser();
    const stranger = await seedUser();
    const id = await seedRecharge(owner);
    mockSession(stranger);
    const res = await upload(id, pdfBody());
    expect(res.statusCode).toBe(404);
  });

  // ── replace path ───────────────────────────────────────────────────────────
  it('re-upload while pending replaces: columns re-stamp, the old object is gone', async () => {
    const me = await seedUser();
    const id = await seedRecharge(me);
    mockSession(me);
    expect((await upload(id, pdfBody())).statusCode).toBe(200);
    const oldKey = `recharges/${id}/justificatif.pdf`;
    expect('body' in (await storage.download({ key: oldKey }))).toBe(true);

    const res = await upload(
      id,
      multipartBody({ filename: 'v2.png', contentType: 'image/png', content: PNG_BYTES }),
    );
    expect(res.statusCode).toBe(200);
    const [row] = await db.select().from(recharges).where(eq(recharges.id, id)).limit(1);
    expect(row?.documentKey).toBe(`recharges/${id}/justificatif.png`);
    expect(row?.documentMime).toBe('image/png');
    expect('error' in (await storage.download({ key: oldKey }))).toBe(true);
    expect('body' in (await storage.download({ key: `recharges/${id}/justificatif.png` }))).toBe(
      true,
    );
  });

  // ── presign scoping matrix ─────────────────────────────────────────────────
  it('owner presign returns a url wrapping the stored key', async () => {
    const me = await seedUser();
    const id = await seedRecharge(me);
    mockSession(me);
    await upload(id, pdfBody());
    const res = await ownerUrl(id);
    expect(res.statusCode).toBe(200);
    expect(res.json<{ url: string }>().url).toContain(`recharges/${id}/justificatif.pdf`);
  });

  it('owner presign: foreign ≡ missing ≡ no-document — one identical 404 body', async () => {
    const owner = await seedUser();
    const stranger = await seedUser();
    const withoutDoc = await seedRecharge(owner);
    const withDoc = await seedRecharge(owner);
    mockSession(owner);
    await upload(withDoc, pdfBody());

    mockSession(stranger);
    const foreign = await ownerUrl(withDoc);
    const missing = await ownerUrl('00000000-0000-4000-8000-000000000000');
    mockSession(owner);
    const noDoc = await ownerUrl(withoutDoc);

    expect(foreign.statusCode).toBe(404);
    expect(missing.statusCode).toBe(404);
    expect(noDoc.statusCode).toBe(404);
    expect(foreign.body).toBe(missing.body);
    expect(noDoc.body).toBe(missing.body);
  });

  it('admin presign works for an admin, 403s a non-admin, 404s a doc-less recharge', async () => {
    const owner = await seedUser();
    const admin = await seedUser({ role: 'admin' });
    const withDoc = await seedRecharge(owner);
    const withoutDoc = await seedRecharge(owner);
    mockSession(owner);
    await upload(withDoc, pdfBody());

    mockSession(admin, 'admin');
    const ok = await adminUrl(withDoc);
    expect(ok.statusCode).toBe(200);
    expect(ok.json<{ url: string }>().url).toContain(`recharges/${withDoc}/justificatif.pdf`);
    expect((await adminUrl(withoutDoc)).statusCode).toBe(404);

    mockSession(owner, 'advertiser');
    expect((await adminUrl(withDoc)).statusCode).toBe(403);
  });

  // ── projections ────────────────────────────────────────────────────────────
  it('admin list + advertiser mine project has_document (+ uploaded_at, mime admin-side)', async () => {
    const me = await seedUser();
    const admin = await seedUser({ role: 'admin' });
    const documented = await seedRecharge(me);
    const bare = await seedRecharge(me);
    mockSession(me);
    await upload(documented, pdfBody());

    const mine = await app.inject({ method: 'GET', url: '/api/recharges/mine' });
    expect(mine.statusCode).toBe(200);
    const mineRows =
      mine.json<{ id: string; has_document: boolean; document_uploaded_at: string | null }[]>();
    const mineDoc = mineRows.find((r) => r.id === documented);
    const mineBare = mineRows.find((r) => r.id === bare);
    expect(mineDoc).toMatchObject({ has_document: true });
    expect(mineDoc?.document_uploaded_at).not.toBeNull();
    expect(mineBare).toMatchObject({ has_document: false, document_uploaded_at: null });

    mockSession(admin, 'admin');
    const list = await app.inject({ method: 'GET', url: '/api/admin/recharges' });
    expect(list.statusCode).toBe(200);
    const rows = list.json<{ id: string; has_document: boolean; document_mime: string | null }[]>();
    expect(rows.find((r) => r.id === documented)).toMatchObject({
      has_document: true,
      document_mime: 'application/pdf',
    });
    expect(rows.find((r) => r.id === bare)).toMatchObject({
      has_document: false,
      document_mime: null,
    });
  });

  it('storage failure on upload → 502 and the row is untouched', async () => {
    const me = await seedUser();
    const id = await seedRecharge(me);
    mockSession(me);
    vi.spyOn(storage, 'upload').mockResolvedValue({ error: 'disk full' });
    const res = await upload(id, pdfBody());
    expect(res.statusCode).toBe(502);
    const [row] = await db
      .select()
      .from(recharges)
      .where(and(eq(recharges.id, id), eq(recharges.advertiserId, me)))
      .limit(1);
    expect(row?.documentKey).toBeNull();
  });

  // ── 401s ───────────────────────────────────────────────────────────────────
  it('401s every document route without a session', async () => {
    const me = await seedUser();
    const id = await seedRecharge(me);
    mockNoSession();
    expect((await upload(id, pdfBody())).statusCode).toBe(401);
    expect((await ownerUrl(id)).statusCode).toBe(401);
    expect((await adminUrl(id)).statusCode).toBe(401);
  });
});
