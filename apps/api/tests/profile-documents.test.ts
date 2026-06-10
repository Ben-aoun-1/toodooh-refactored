import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import { userDocuments, users } from '../src/db/schema.js';
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
// inject). Single `file` part — category/position ride in the URL.
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

type DocView = {
  id: string;
  category: string;
  position: number;
  original_filename: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  uploaded_at: string;
};
type Grouped = { cin: DocView[]; rne: DocView[]; complementaire: DocView[]; bank: DocView[] };

describe('multi-document routes /api/profile/documents (real Postgres + MinIO)', () => {
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
    // Rows still exist here (the truncate runs in the NEXT test's beforeEach) — sweep their
    // MinIO objects so reruns stay clean.
    const rows = await db.select({ key: userDocuments.storageKey }).from(userDocuments);
    for (const r of rows) await storage.delete({ key: r.key }).catch(() => undefined);
    await app.close();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await sql.end();
  });

  const pdf = Buffer.from('%PDF-1.4 fake doc bytes');
  const png = Buffer.from('fake png bytes');
  const post = (category: string, body: ReturnType<typeof multipartBody>, position?: number) =>
    app.inject({
      method: 'POST',
      url: `/api/profile/documents/${category}${position === undefined ? '' : `?position=${position}`}`,
      ...body,
    });
  const grouped = async (): Promise<Grouped> => {
    const res = await app.inject({ method: 'GET', url: '/api/profile/documents' });
    expect(res.statusCode).toBe(200);
    return res.json<{ documents: Grouped }>().documents;
  };
  const presign = (id: string) =>
    app.inject({ method: 'GET', url: `/api/profile/documents/${id}/url` });
  const del = (id: string) => app.inject({ method: 'DELETE', url: `/api/profile/documents/${id}` });
  const pdfBody = (name = 'doc.pdf') =>
    multipartBody({ filename: name, contentType: 'application/pdf', content: pdf });

  it('POST cin recto (1) + verso (2) → two rows, keys are <category>/<userId>/<docId>', async () => {
    mockSession(userId);
    const recto = await post('cin', pdfBody('recto.pdf'), 1);
    const verso = await post(
      'cin',
      multipartBody({ filename: 'verso.png', contentType: 'image/png', content: png }),
      2,
    );
    expect(recto.statusCode).toBe(200);
    expect(verso.statusCode).toBe(200);
    const docs = await grouped();
    expect(docs.cin).toHaveLength(2);
    expect(docs.cin.map((d) => d.position)).toEqual([1, 2]);
    expect(docs.cin[0]?.original_filename).toBe('recto.pdf');
    expect(docs.cin[1]?.mime_type).toBe('image/png');
    const [row] = await db.select().from(userDocuments).limit(1);
    expect(row?.storageKey).toBe(`${row?.category}/${row?.userId}/${row?.id}`);
  });

  it('POST cin without position → 400 (slots are semantic: 1=recto, 2=verso)', async () => {
    mockSession(userId);
    const res = await post('cin', pdfBody());
    expect(res.statusCode).toBe(400);
    expect(res.json<{ fields: { field: string }[] }>().fields[0]?.field).toBe('position');
  });

  it('position above the category cap → 400 (cin 3, complementaire 11)', async () => {
    mockSession(userId);
    expect((await post('cin', pdfBody(), 3)).statusCode).toBe(400);
    expect((await post('complementaire', pdfBody(), 11)).statusCode).toBe(400);
  });

  it('rne auto-fills slots 1 then 2; a third upload → 409 CATEGORY_FULL', async () => {
    mockSession(userId);
    expect((await post('rne', pdfBody('a.pdf'))).statusCode).toBe(200);
    expect((await post('rne', pdfBody('b.pdf'))).statusCode).toBe(200);
    const docs = await grouped();
    expect(docs.rne.map((d) => d.position)).toEqual([1, 2]);
    const third = await post('rne', pdfBody('c.pdf'));
    expect(third.statusCode).toBe(409);
    expect(third.json<{ error: string }>().error).toBe('CATEGORY_FULL');
  });

  it('complementaire holds 10, the 11th → 409', async () => {
    mockSession(userId);
    for (let i = 1; i <= 10; i += 1) {
      expect((await post('complementaire', pdfBody(`piece-${i}.pdf`))).statusCode).toBe(200);
    }
    expect((await post('complementaire', pdfBody('piece-11.pdf'))).statusCode).toBe(409);
    expect((await grouped()).complementaire).toHaveLength(10);
  });

  it('bank caps at 1: a second no-position upload REPLACES slot 1 (one row, new bytes)', async () => {
    mockSession(userId);
    expect((await post('bank', pdfBody('rib-v1.pdf'))).statusCode).toBe(200);
    const v2 = Buffer.from('%PDF-1.4 SECOND rib');
    const res2 = await post(
      'bank',
      multipartBody({ filename: 'rib-v2.pdf', contentType: 'application/pdf', content: v2 }),
    );
    expect(res2.statusCode).toBe(200);
    const docs = await grouped();
    expect(docs.bank).toHaveLength(1);
    expect(docs.bank[0]?.original_filename).toBe('rib-v2.pdf');
    const url = (await presign(docs.bank[0]?.id ?? '')).json<{ url: string }>().url;
    const fetched = Buffer.from(await (await fetch(url)).arrayBuffer());
    expect(fetched.equals(v2)).toBe(true);
  });

  it('same-slot re-upload replaces in place (same row id, updated metadata)', async () => {
    mockSession(userId);
    await post('cin', pdfBody('recto-old.pdf'), 1);
    const before = (await grouped()).cin[0];
    await post(
      'cin',
      multipartBody({ filename: 'recto-new.png', contentType: 'image/png', content: png }),
      1,
    );
    const after = (await grouped()).cin;
    expect(after).toHaveLength(1);
    expect(after[0]?.id).toBe(before?.id);
    expect(after[0]?.original_filename).toBe('recto-new.png');
    expect(after[0]?.size_bytes).toBe(png.length);
  });

  it('GET /:id/url presigns the document bytes; foreign or unknown id → 404', async () => {
    mockSession(userId);
    await post('rne', pdfBody(), 1);
    const doc = (await grouped()).rne[0];
    const res = await presign(doc?.id ?? '');
    expect(res.statusCode).toBe(200);
    const fetched = Buffer.from(await (await fetch(res.json<{ url: string }>().url)).arrayBuffer());
    expect(fetched.equals(pdf)).toBe(true);

    // Another user cannot presign it (owner-scoped 404, indistinguishable from missing).
    const [other] = await db
      .insert(users)
      .values({ email: 'other@example.com', contactName: 'Other' })
      .returning();
    mockSession(other?.id ?? '');
    expect((await presign(doc?.id ?? '')).statusCode).toBe(404);
  });

  it('DELETE is owner-scoped: owner removes row + object; a stranger gets 404', async () => {
    mockSession(userId);
    await post('complementaire', pdfBody('extra.pdf'));
    const doc = (await grouped()).complementaire[0];
    const key = `complementaire/${userId}/${doc?.id}`;

    const [other] = await db
      .insert(users)
      .values({ email: 'other@example.com', contactName: 'Other' })
      .returning();
    mockSession(other?.id ?? '');
    expect((await del(doc?.id ?? '')).statusCode).toBe(404);

    mockSession(userId);
    const res = await del(doc?.id ?? '');
    expect(res.statusCode).toBe(200);
    expect((await grouped()).complementaire).toHaveLength(0);
    // Row-owned object is swept with the row: presigning still signs (no existence check),
    // but fetching the key must now miss.
    const presigned = await storage.getPresignedUrl({ key });
    if ('url' in presigned) {
      expect((await fetch(presigned.url)).status).not.toBe(200);
    }
  });

  it('backfilled row (legacy <type>/<userId> key) is readable; DELETE keeps its object', async () => {
    const legacyKey = `rne/${userId}`;
    await storage.upload({ key: legacyKey, body: pdf, contentType: 'application/pdf' });
    const [row] = await db
      .insert(userDocuments)
      .values({ userId, category: 'rne', position: 1, storageKey: legacyKey })
      .returning();

    mockSession(userId);
    const docs = await grouped();
    expect(docs.rne).toHaveLength(1);
    expect(docs.rne[0]?.original_filename).toBeNull(); // backfill never knew it
    const res = await presign(row?.id ?? '');
    expect(res.statusCode).toBe(200);
    const fetched = Buffer.from(await (await fetch(res.json<{ url: string }>().url)).arrayBuffer());
    expect(fetched.equals(pdf)).toBe(true);

    // Deleting the row must NOT delete the legacy object (the frozen users column may
    // still reference it).
    expect((await del(row?.id ?? '')).statusCode).toBe(200);
    const presigned = await storage.getPresignedUrl({ key: legacyKey });
    expect('url' in presigned).toBe(true);
    if ('url' in presigned) {
      expect((await fetch(presigned.url)).status).toBe(200);
    }
    await storage.delete({ key: legacyKey }).catch(() => undefined);
  });

  it('COMPAT GET /:category presigns position 1 from the table (the F1 bank read)', async () => {
    mockSession(userId);
    const posted = await post('bank', pdfBody('rib.pdf'));
    // POST carries the deprecated {type, key} compat fields the F1 bank hook still reads.
    const compat = posted.json<{ type: string; key: string; document: { id: string } }>();
    expect(compat.type).toBe('bank');
    expect(compat.key).toBe(`bank/${userId}/${compat.document.id}`);
    const res = await app.inject({ method: 'GET', url: '/api/profile/documents/bank' });
    expect(res.statusCode).toBe(200);
    const fetched = Buffer.from(await (await fetch(res.json<{ url: string }>().url)).arrayBuffer());
    expect(fetched.equals(pdf)).toBe(true);
  });

  it('COMPAT GET with no document → 404; invalid category → 400', async () => {
    mockSession(userId);
    expect(
      (await app.inject({ method: 'GET', url: '/api/profile/documents/bank' })).statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ method: 'GET', url: '/api/profile/documents/passport' })).statusCode,
    ).toBe(400);
  });

  it('invalid category on POST → 400', async () => {
    mockSession(userId);
    expect((await post('passport', pdfBody())).statusCode).toBe(400);
  });

  it('oversized → 413, no row written', async () => {
    mockSession(userId);
    const big = Buffer.alloc(5 * 1024 * 1024 + 1, 0x41);
    const res = await post(
      'rne',
      multipartBody({ filename: 'big.pdf', contentType: 'application/pdf', content: big }),
    );
    expect(res.statusCode).toBe(413);
    expect(await db.select().from(userDocuments)).toHaveLength(0);
  });

  it('bad MIME → 400', async () => {
    mockSession(userId);
    const res = await post(
      'rne',
      multipartBody({ filename: 'x.txt', contentType: 'text/plain', content: Buffer.from('hi') }),
    );
    expect(res.statusCode).toBe(400);
  });

  it('StorageProvider failure → 502, no row written', async () => {
    mockSession(userId);
    vi.spyOn(storage, 'upload').mockResolvedValue({ error: 'disk full' });
    const res = await post('rne', pdfBody());
    expect(res.statusCode).toBe(502);
    expect(await db.select().from(userDocuments)).toHaveLength(0);
  });

  it('unauthenticated → 401 on every route', async () => {
    vi.spyOn(auth.api, 'getSession').mockResolvedValue(null);
    expect((await post('rne', pdfBody())).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/profile/documents' })).statusCode).toBe(
      401,
    );
    expect((await presign('00000000-0000-0000-0000-000000000000')).statusCode).toBe(401);
    expect((await del('00000000-0000-0000-0000-000000000000')).statusCode).toBe(401);
  });
});
