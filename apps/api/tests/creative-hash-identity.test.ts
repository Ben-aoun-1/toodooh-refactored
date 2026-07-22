import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import { type NewUser, creatives, users } from '../src/db/schema.js';
import { hashCreativeBytes } from '../src/lib/creative-identity.js';
import { creativesRoutes } from '../src/routes/creatives.js';
import { storage } from '../src/storage/s3-storage.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// CF-SK1 (spec §2.1, ruling #9) — file-hash identity + approval inheritance. Real Postgres +
// real MinIO (the creatives upload harness). Fixtures are the CF-SH1 real media (byte-sniffed).

type GetSessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;

const buildApp = () => Fastify({ logger: false });

const mockSession = (userId: string): void => {
  vi.spyOn(auth.api, 'getSession').mockResolvedValue({
    session: {},
    user: { id: userId, role: 'advertiser', status: 'approved' },
  } as unknown as GetSessionResult);
};

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

const fixture = (name: string): Buffer => readFileSync(join(import.meta.dirname, 'fixtures', name));
const VIDEO = fixture('h264-169.mp4');
const PHOTO = fixture('photo.jpg');
const videoFile = () =>
  multipartBody({ filename: 'clip.mp4', contentType: 'video/mp4', content: VIDEO });
const photoFile = () =>
  multipartBody({ filename: 'shot.jpg', contentType: 'image/jpeg', content: PHOTO });

let seq = 0;
const seedUser = async (values: Partial<NewUser> = {}): Promise<string> => {
  seq += 1;
  const [u] = await db
    .insert(users)
    .values({
      email: `hashid${seq}@example.com`,
      contactName: `User ${seq}`,
      role: 'advertiser',
      status: 'approved',
      ...values,
    })
    .returning();
  return u?.id ?? '';
};

describe('CF-SK1 — creative file-hash identity + approval inheritance (real Postgres + MinIO)', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    await resetAuthTables();
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

  const upload = (body: ReturnType<typeof multipartBody>) =>
    app.inject({
      method: 'POST',
      url: '/api/creatives?type=video&duration_seconds=25',
      ...body,
    });
  const uploadPhoto = (body: ReturnType<typeof multipartBody>) =>
    app.inject({
      method: 'POST',
      url: '/api/creatives?type=photo&duration_seconds=10',
      ...body,
    });
  const rowOf = async (id: string) => {
    const [row] = await db.select().from(creatives).where(eq(creatives.id, id)).limit(1);
    return row;
  };
  const approve = (id: string) =>
    db.update(creatives).set({ validationStatus: 'approved' }).where(eq(creatives.id, id));

  it('every new upload stores the sha256 of its bytes', async () => {
    const me = await seedUser();
    mockSession(me);
    const res = await upload(videoFile());
    expect(res.statusCode).toBe(201);
    const row = await rowOf(res.json<{ id: string }>().id);
    expect(row?.fileHash).toBe(hashCreativeBytes(VIDEO));
    expect(row?.validationStatus).toBe('pending'); // first upload is unmoderated
  });

  it('SAME owner re-uploading APPROVED bytes → born approved + the inheritance audit note', async () => {
    const me = await seedUser();
    mockSession(me);
    const first = await upload(videoFile());
    const firstId = first.json<{ id: string }>().id;
    await approve(firstId);

    const second = await upload(videoFile());
    expect(second.statusCode).toBe(201);
    const row = await rowOf(second.json<{ id: string }>().id);
    expect(row?.validationStatus).toBe('approved');
    expect(row?.validationNotes).toContain(firstId);
    expect(row?.validationNotes).toContain('héritée');
    expect(row?.validatedAt).not.toBeNull();
    expect(row?.fileHash).toBe(hashCreativeBytes(VIDEO));
  });

  it('CROSS-OWNER never inherits: same bytes, different advertiser → pending', async () => {
    const owner = await seedUser();
    mockSession(owner);
    const first = await upload(videoFile());
    await approve(first.json<{ id: string }>().id);

    const stranger = await seedUser();
    mockSession(stranger);
    const second = await upload(videoFile());
    const row = await rowOf(second.json<{ id: string }>().id);
    expect(row?.validationStatus).toBe('pending');
    expect(row?.validationNotes).toBeNull();
    // The hash IS the same — only the (owner, hash) scoping keeps them apart.
    expect(row?.fileHash).toBe(hashCreativeBytes(VIDEO));
  });

  it('DIFFERENT bytes, same owner → pending (a modified file is a NEW spot)', async () => {
    const me = await seedUser();
    mockSession(me);
    const first = await upload(videoFile());
    await approve(first.json<{ id: string }>().id);

    const second = await uploadPhoto(photoFile()); // different bytes entirely
    const row = await rowOf(second.json<{ id: string }>().id);
    expect(row?.validationStatus).toBe('pending');
    expect(row?.fileHash).toBe(hashCreativeBytes(PHOTO));
    expect(row?.fileHash).not.toBe(hashCreativeBytes(VIDEO));
  });

  it('a REJECTED original carries no clearance: same bytes re-upload → pending', async () => {
    const me = await seedUser();
    mockSession(me);
    const first = await upload(videoFile());
    await db
      .update(creatives)
      .set({ validationStatus: 'rejected' })
      .where(eq(creatives.id, first.json<{ id: string }>().id));

    const second = await upload(videoFile());
    const row = await rowOf(second.json<{ id: string }>().id);
    expect(row?.validationStatus).toBe('pending');
  });

  it('a still-PENDING original carries no clearance either', async () => {
    const me = await seedUser();
    mockSession(me);
    await upload(videoFile()); // left pending
    const second = await upload(videoFile());
    const row = await rowOf(second.json<{ id: string }>().id);
    expect(row?.validationStatus).toBe('pending');
  });
});
