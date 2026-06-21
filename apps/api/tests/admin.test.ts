import { eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth, emailSender } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import { type NewUser, screenhosts, userDocuments, users } from '../src/db/schema.js';
import { encryptWifiPassword } from '../src/lib/wifi-crypto.js';
import { adminRoutes } from '../src/routes/admin.js';
import { storage } from '../src/storage/s3-storage.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// The reject route now sends a non-blocking notification email (N3 Scenario 1). Mock nodemailer so
// no real SMTP is attempted (mirrors the me/signin suites); the email-specific tests spy on
// emailSender.send to assert invocation / simulate a send failure.
const { sendMailMock } = vi.hoisted(() => ({
  sendMailMock: vi.fn().mockResolvedValue({ messageId: 'test-msg-id' }),
}));
vi.mock('nodemailer', () => ({
  default: { createTransport: vi.fn(() => ({ sendMail: sendMailMock })) },
}));

// Integration suite — real Postgres (DATABASE_URL); the doc-review happy paths also need real
// MinIO (STORAGE_*), exactly like profile-documents.test.ts. auth.api.getSession is mocked (its
// behavior lives in require-auth.test.ts); endpoint logic runs against real rows. The actor admin
// is a real users row (validated_by self-FKs users.id), seeded per test.
type GetSessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;

const buildApp = () => Fastify({ logger: false });

// D-G1-5: direct db.insert + mocked session, NOT create-admin.ts. One local helper (duplication
// across four endpoints is real) — per-file convention, like the other suites' mockSession.
const mockSession = (userId: string, role = 'superadmin', status = 'approved'): void => {
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
    .values({ email: `u${seq}@example.com`, contactName: `User ${seq}`, ...values })
    .returning();
  return u?.id ?? '';
};

const NO_ROW_ID = '00000000-0000-0000-0000-000000000000';

describe('admin endpoints (real Postgres)', () => {
  let app: ReturnType<typeof buildApp>;
  let adminId: string;

  beforeEach(async () => {
    await resetAuthTables();
    adminId = await seedUser({ role: 'superadmin', status: 'approved' });
    app = buildApp();
    await app.register(adminRoutes);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await sql.end();
  });

  describe('requireAdmin gate (via GET /api/admin/users)', () => {
    const list = () => app.inject({ method: 'GET', url: '/api/admin/users?status=pending' });

    it('admin → 200', async () => {
      const id = await seedUser({ role: 'admin' });
      mockSession(id, 'admin');
      expect((await list()).statusCode).toBe(200);
    });

    it('superadmin → 200', async () => {
      mockSession(adminId, 'superadmin');
      expect((await list()).statusCode).toBe(200);
    });

    it('non-admin (advertiser) → 403', async () => {
      mockSession(adminId, 'advertiser');
      const res = await list();
      expect(res.statusCode).toBe(403);
      expect(res.json<{ error: string }>().error).toBe('FORBIDDEN');
    });

    it('no session → 401', async () => {
      vi.spyOn(auth.api, 'getSession').mockResolvedValue(null);
      expect((await list()).statusCode).toBe(401);
    });
  });

  describe('GET /api/admin/users', () => {
    const list = (status: string) =>
      app.inject({ method: 'GET', url: `/api/admin/users?status=${status}` });

    beforeEach(async () => {
      // Two pending with distinct created_at (older first inserted), one approved, one rejected.
      await seedUser({ status: 'pending', createdAt: new Date('2026-01-01T00:00:00Z') });
      await seedUser({ status: 'pending', createdAt: new Date('2026-02-01T00:00:00Z') });
      await seedUser({ status: 'approved' });
      await seedUser({ status: 'rejected' });
      mockSession(adminId);
    });

    it('status=pending → only pending, created_at DESC', async () => {
      const res = await list('pending');
      expect(res.statusCode).toBe(200);
      const body = res.json<{ users: { status: string; created_at: string }[] }>();
      expect(body.users).toHaveLength(2);
      expect(body.users.every((u) => u.status === 'pending')).toBe(true);
      expect(new Date(body.users[0]!.created_at).getTime()).toBeGreaterThan(
        new Date(body.users[1]!.created_at).getTime(),
      );
    });

    it('status=approved → only approved', async () => {
      const res = await list('approved');
      const body = res.json<{ users: { status: string }[] }>();
      expect(body.users).toHaveLength(1);
      expect(body.users[0]?.status).toBe('approved');
    });

    it('excludes internal-account roles (admin/superadmin + agents) from the queue', async () => {
      await seedUser({ role: 'screenhost_agent', status: 'approved' });
      await seedUser({ role: 'screencast_agent', status: 'approved' });
      await seedUser({ role: 'admin', status: 'approved' });
      const body = (await list('approved')).json<{ users: { role: string }[] }>();
      const roles = body.users.map((u) => u.role);
      expect(roles).not.toContain('screenhost_agent');
      expect(roles).not.toContain('screencast_agent');
      expect(roles).not.toContain('admin');
      expect(roles).not.toContain('superadmin');
      expect(roles).toContain('advertiser'); // the lone approved end-user still shows
    });

    it('projection carries bank details + documents.bank (F6 — admin user-info view)', async () => {
      const withBank = await seedUser({
        status: 'pending',
        bankAccountHolder: 'Café Central SARL',
        bankRib: '12345678901234567890',
        bankIban: 'TN5912345678901234567890',
        bankDetailsUpdatedAt: new Date('2026-06-01T00:00:00Z'),
      });
      // documents.bank presence reads user_documents (F-docs Commit 1), not the frozen column.
      await db
        .insert(userDocuments)
        .values({ userId: withBank, category: 'bank', position: 1, storageKey: 'bank/seeded' });
      const body = (await list('pending')).json<{
        users: {
          id: string;
          bank_account_holder: string | null;
          bank_rib: string | null;
          bank_iban: string | null;
          bank_details_updated_at: string | null;
          documents: { registration: boolean; cin: boolean; bank: boolean };
        }[];
      }>();
      const row = body.users.find((u) => u.id === withBank);
      expect(row?.bank_account_holder).toBe('Café Central SARL');
      expect(row?.bank_rib).toBe('12345678901234567890');
      expect(row?.bank_iban).toBe('TN5912345678901234567890');
      expect(new Date(row?.bank_details_updated_at ?? '').toISOString()).toBe(
        '2026-06-01T00:00:00.000Z',
      );
      expect(row?.documents).toEqual({ registration: false, cin: false, bank: true });
      // A user without bank details serializes null/false — no server-side coalescing.
      const bare = body.users.find((u) => u.id !== withBank);
      expect(bare?.bank_account_holder).toBeNull();
      expect(bare?.bank_details_updated_at).toBeNull();
      expect(bare?.documents.bank).toBe(false);
    });

    it('projection carries the owner’s screenhosts with wifi_password_set, never the password', async () => {
      const owner = await seedUser({ status: 'pending', role: 'individual_owner' });
      await db.insert(screenhosts).values([
        {
          name: 'Café A',
          ownerId: owner,
          wifiSsid: 'NET-A',
          wifiPasswordEncrypted: encryptWifiPassword('secret-a'),
        },
        { name: 'Café B', ownerId: owner, wifiSsid: null, wifiPasswordEncrypted: null },
      ]);
      const body = (await list('pending')).json<{
        users: {
          id: string;
          screenhosts: {
            id: string;
            name: string;
            wifi_ssid: string | null;
            wifi_password_set: boolean;
          }[];
        }[];
      }>();
      const row = body.users.find((u) => u.id === owner);
      expect(row?.screenhosts).toHaveLength(2);
      const a = row?.screenhosts.find((s) => s.name === 'Café A');
      const b = row?.screenhosts.find((s) => s.name === 'Café B');
      expect(a).toMatchObject({ wifi_ssid: 'NET-A', wifi_password_set: true });
      expect(b).toMatchObject({ wifi_ssid: null, wifi_password_set: false });
      // The cipher/plaintext must never reach the wire — the view exposes only the presence flag.
      expect(Object.keys(a ?? {}).sort()).toEqual(['id', 'name', 'wifi_password_set', 'wifi_ssid']);
      expect(JSON.stringify(row)).not.toContain('secret-a');
      expect(JSON.stringify(row)).not.toContain('wifiPasswordEncrypted');
      // A user with no screenhosts serializes an empty array.
      const bare = body.users.find((u) => u.id !== owner);
      expect(bare?.screenhosts).toEqual([]);
    });

    it('missing status → 400', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/admin/users' });
      expect(res.statusCode).toBe(400);
    });

    it('invalid status → 400', async () => {
      expect((await list('banned')).statusCode).toBe(400);
    });
  });

  describe('POST /api/admin/users/:id/approve', () => {
    const approve = (id: string, body?: Record<string, unknown>) =>
      app.inject({ method: 'POST', url: `/api/admin/users/${id}/approve`, payload: body ?? {} });

    it('happy → approved + onboarding_completed + trio on the row', async () => {
      const target = await seedUser({ status: 'pending' });
      mockSession(adminId);
      const res = await approve(target, { notes: 'looks good' });
      expect(res.statusCode).toBe(200);
      const [row] = await db.select().from(users).where(eq(users.id, target));
      expect(row?.status).toBe('approved');
      expect(row?.onboardingCompleted).toBe(true);
      expect(row?.validatedBy).toBe(adminId);
      expect(row?.validatedAt).not.toBeNull();
      expect(row?.validationNotes).toBe('looks good');
    });

    it('no notes → approved, validation_notes null', async () => {
      const target = await seedUser({ status: 'pending' });
      mockSession(adminId);
      expect((await approve(target)).statusCode).toBe(200);
      const [row] = await db.select().from(users).where(eq(users.id, target));
      expect(row?.status).toBe('approved');
      expect(row?.validationNotes).toBeNull();
    });

    it('unknown id → 404 USER_NOT_FOUND', async () => {
      mockSession(adminId);
      const res = await approve(NO_ROW_ID);
      expect(res.statusCode).toBe(404);
      expect(res.json<{ error: string }>().error).toBe('USER_NOT_FOUND');
    });

    it('non-uuid id → 400', async () => {
      mockSession(adminId);
      expect((await approve('not-a-uuid')).statusCode).toBe(400);
    });

    it('already-approved → 409 with prior-state body', async () => {
      const target = await seedUser({
        status: 'approved',
        validatedBy: adminId,
        validatedAt: new Date(),
        validationNotes: 'first pass',
      });
      mockSession(adminId);
      const res = await approve(target, { notes: 'again' });
      expect(res.statusCode).toBe(409);
      const body = res.json<{ error: string; currentStatus: string; validationNotes: string }>();
      expect(body.error).toBe('CONFLICT');
      expect(body.currentStatus).toBe('approved');
      expect(body.validationNotes).toBe('first pass');
    });

    it('rejected → approve allowed (different target state)', async () => {
      const target = await seedUser({ status: 'rejected', validationNotes: 'was rejected' });
      mockSession(adminId);
      const res = await approve(target, { notes: 'reconsidered' });
      expect(res.statusCode).toBe(200);
      const [row] = await db.select().from(users).where(eq(users.id, target));
      expect(row?.status).toBe('approved');
      expect(row?.validationNotes).toBe('reconsidered');
    });

    it('non-admin → 403', async () => {
      const target = await seedUser({ status: 'pending' });
      mockSession(adminId, 'advertiser');
      expect((await approve(target)).statusCode).toBe(403);
    });

    it('no session → 401', async () => {
      const target = await seedUser({ status: 'pending' });
      vi.spyOn(auth.api, 'getSession').mockResolvedValue(null);
      expect((await approve(target)).statusCode).toBe(401);
    });
  });

  describe('POST /api/admin/users/:id/reject', () => {
    const reject = (id: string, body?: Record<string, unknown>) =>
      app.inject({ method: 'POST', url: `/api/admin/users/${id}/reject`, payload: body ?? {} });

    it('happy → rejected + trio + topics, onboarding_completed untouched', async () => {
      const target = await seedUser({ status: 'pending', onboardingCompleted: false });
      mockSession(adminId);
      const res = await reject(target, { notes: 'missing CIN', topics: ['legal'] });
      expect(res.statusCode).toBe(200);
      const [row] = await db.select().from(users).where(eq(users.id, target));
      expect(row?.status).toBe('rejected');
      expect(row?.validatedBy).toBe(adminId);
      expect(row?.validatedAt).not.toBeNull();
      expect(row?.validationNotes).toBe('missing CIN');
      expect(row?.rejectionTopics).toEqual(['legal']);
      expect(row?.onboardingCompleted).toBe(false);
    });

    it('stores BOTH topics and sends the notification email', async () => {
      const target = await seedUser({ status: 'pending' });
      mockSession(adminId);
      const sendSpy = vi.spyOn(emailSender, 'send');
      const res = await reject(target, {
        notes: 'CIN illisible + RIB manquant',
        topics: ['legal', 'bank'],
      });
      expect(res.statusCode).toBe(200);
      const [row] = await db.select().from(users).where(eq(users.id, target));
      expect(row?.rejectionTopics).toEqual(['legal', 'bank']);
      expect(sendSpy).toHaveBeenCalledTimes(1);
    });

    it('without a topic → 400 (at least one required)', async () => {
      const target = await seedUser({ status: 'pending' });
      mockSession(adminId);
      expect((await reject(target, { notes: 'x' })).statusCode).toBe(400);
      expect((await reject(target, { notes: 'x', topics: [] })).statusCode).toBe(400);
    });

    it('an email-send failure does NOT fail the reject (non-blocking — it still records)', async () => {
      const target = await seedUser({ status: 'pending' });
      mockSession(adminId);
      vi.spyOn(emailSender, 'send').mockResolvedValueOnce({ error: 'smtp down' });
      const res = await reject(target, { notes: 'x', topics: ['legal'] });
      expect(res.statusCode).toBe(200);
      const [row] = await db.select().from(users).where(eq(users.id, target));
      expect(row?.status).toBe('rejected');
      expect(row?.rejectionTopics).toEqual(['legal']);
    });

    it('missing notes → 400', async () => {
      const target = await seedUser({ status: 'pending' });
      mockSession(adminId);
      expect((await reject(target)).statusCode).toBe(400);
    });

    it('empty/whitespace notes → 400', async () => {
      const target = await seedUser({ status: 'pending' });
      mockSession(adminId);
      expect((await reject(target, { notes: '   ' })).statusCode).toBe(400);
    });

    it('unknown id → 404 USER_NOT_FOUND', async () => {
      mockSession(adminId);
      const res = await reject(NO_ROW_ID, { notes: 'x', topics: ['legal'] });
      expect(res.statusCode).toBe(404);
      expect(res.json<{ error: string }>().error).toBe('USER_NOT_FOUND');
    });

    it('already-rejected → 409 with prior-state body', async () => {
      const target = await seedUser({
        status: 'rejected',
        validatedBy: adminId,
        validatedAt: new Date(),
        validationNotes: 'first reject',
      });
      mockSession(adminId);
      const res = await reject(target, { notes: 'again', topics: ['legal'] });
      expect(res.statusCode).toBe(409);
      const body = res.json<{ error: string; currentStatus: string }>();
      expect(body.error).toBe('CONFLICT');
      expect(body.currentStatus).toBe('rejected');
    });

    it('non-admin → 403', async () => {
      const target = await seedUser({ status: 'pending' });
      mockSession(adminId, 'advertiser');
      expect((await reject(target, { notes: 'x' })).statusCode).toBe(403);
    });
  });

  describe('admin document review endpoints (real Postgres + MinIO)', () => {
    const pdf = Buffer.from('%PDF-1.4 fake admin-review bytes');
    const uploadedKeys: string[] = [];

    afterEach(async () => {
      for (const key of uploadedKeys) await storage.delete({ key }).catch(() => undefined);
      uploadedKeys.length = 0;
    });

    const getDoc = (id: string, type: string) =>
      app.inject({ method: 'GET', url: `/api/admin/users/${id}/documents/${type}` });
    const listDocs = (id: string) =>
      app.inject({ method: 'GET', url: `/api/admin/users/${id}/documents` });
    const presignDoc = (id: string, docId: string) =>
      app.inject({ method: 'GET', url: `/api/admin/users/${id}/documents/${docId}/url` });

    // Seeds a user_documents row (F-docs Commit 1 — the users.*_doc_url columns are frozen).
    // A legacy-style key stands in for a backfilled document.
    const seedDoc = async (
      type: 'rne' | 'cin' | 'complementaire' | 'bank',
      position = 1,
      ownerId?: string,
    ): Promise<{ target: string; docId: string }> => {
      const target = ownerId ?? (await seedUser({ status: 'pending' }));
      const key = `${type}/${target}-${position}`;
      await storage.upload({ key, body: pdf, contentType: 'application/pdf' });
      uploadedKeys.push(key);
      const [row] = await db
        .insert(userDocuments)
        .values({ userId: target, category: type, position, storageKey: key })
        .returning();
      return { target, docId: row?.id ?? '' };
    };

    it('compat :type rne → 200 { url } fetching the uploaded bytes (table-backed)', async () => {
      const { target } = await seedDoc('rne');
      mockSession(adminId);
      const res = await getDoc(target, 'rne');
      expect(res.statusCode).toBe(200);
      const fetched = Buffer.from(
        await (await fetch(res.json<{ url: string }>().url)).arrayBuffer(),
      );
      expect(fetched.equals(pdf)).toBe(true);
    });

    it('compat :type cin → 200 { url }', async () => {
      const { target } = await seedDoc('cin');
      mockSession(adminId);
      expect((await getDoc(target, 'cin')).statusCode).toBe(200);
    });

    it('compat :type bank → 200 { url } (F6 — admin bank-details review, table-backed)', async () => {
      const { target } = await seedDoc('bank');
      mockSession(adminId);
      expect((await getDoc(target, 'bank')).statusCode).toBe(200);
    });

    it('compat :type with no document → 404 DOCUMENT_NOT_UPLOADED', async () => {
      const target = await seedUser({ status: 'pending' });
      mockSession(adminId);
      const res = await getDoc(target, 'cin');
      expect(res.statusCode).toBe(404);
      const body = res.json<{ error: string; documentType: string }>();
      expect(body.error).toBe('DOCUMENT_NOT_UPLOADED');
      expect(body.documentType).toBe('cin');
    });

    it('bank with no document on file → 404 DOCUMENT_NOT_UPLOADED (F6)', async () => {
      const target = await seedUser({ status: 'pending' });
      mockSession(adminId);
      const res = await getDoc(target, 'bank');
      expect(res.statusCode).toBe(404);
      const body = res.json<{ error: string; documentType: string }>();
      expect(body.error).toBe('DOCUMENT_NOT_UPLOADED');
      expect(body.documentType).toBe('bank');
    });

    it('unknown user → 404 USER_NOT_FOUND (compat + list)', async () => {
      mockSession(adminId);
      expect((await getDoc(NO_ROW_ID, 'rne')).json<{ error: string }>().error).toBe(
        'USER_NOT_FOUND',
      );
      expect((await listDocs(NO_ROW_ID)).json<{ error: string }>().error).toBe('USER_NOT_FOUND');
    });

    it('invalid type → 400', async () => {
      const target = await seedUser({ status: 'pending' });
      mockSession(adminId);
      expect((await getDoc(target, 'passport')).statusCode).toBe(400);
    });

    it('non-admin → 403 on all three document routes', async () => {
      const { target, docId } = await seedDoc('rne');
      mockSession(adminId, 'advertiser');
      expect((await getDoc(target, 'rne')).statusCode).toBe(403);
      expect((await listDocs(target)).statusCode).toBe(403);
      expect((await presignDoc(target, docId)).statusCode).toBe(403);
    });

    it('GET /:id/documents lists ALL documents grouped by category', async () => {
      const { target } = await seedDoc('cin', 1);
      await seedDoc('cin', 2, target);
      await seedDoc('complementaire', 1, target);
      mockSession(adminId);
      const res = await listDocs(target);
      expect(res.statusCode).toBe(200);
      const docs = res.json<{
        documents: { cin: { position: number }[]; complementaire: unknown[]; rne: unknown[] };
      }>().documents;
      expect(docs.cin.map((d) => d.position)).toEqual([1, 2]);
      expect(docs.complementaire).toHaveLength(1);
      expect(docs.rne).toHaveLength(0);
    });

    it('GET /:id/documents/:docId/url presigns one document; wrong user pairing → 404', async () => {
      const { target, docId } = await seedDoc('cin');
      mockSession(adminId);
      const res = await presignDoc(target, docId);
      expect(res.statusCode).toBe(200);
      const fetched = Buffer.from(
        await (await fetch(res.json<{ url: string }>().url)).arrayBuffer(),
      );
      expect(fetched.equals(pdf)).toBe(true);
      // A document id must only presign under ITS user — a mismatched pair 404s.
      const stranger = await seedUser({ status: 'pending' });
      expect((await presignDoc(stranger, docId)).statusCode).toBe(404);
    });

    // The moderation-list presence map reads user_documents. CIN is the only multi-face category:
    // it counts complete ONLY when BOTH semantic slots — recto (1) and verso (2) — are present
    // (Kais N5). registration (rne) and bank stay present-if-any.
    const presenceOf = async (id: string) => {
      const res = await app.inject({ method: 'GET', url: '/api/admin/users?status=pending' });
      expect(res.statusCode).toBe(200);
      return res
        .json<{
          users: {
            id: string;
            documents: { registration: boolean; cin: boolean; bank: boolean };
          }[];
        }>()
        .users.find((u) => u.id === id)?.documents;
    };

    it('moderation list presence: a single CIN face (recto only) is INCOMPLETE', async () => {
      const { target } = await seedDoc('cin', 1);
      mockSession(adminId);
      expect(await presenceOf(target)).toEqual({ registration: false, cin: false, bank: false });
    });

    it('moderation list presence: a single CIN face (verso only) is INCOMPLETE', async () => {
      const { target } = await seedDoc('cin', 2);
      mockSession(adminId);
      expect(await presenceOf(target)).toEqual({ registration: false, cin: false, bank: false });
    });

    it('moderation list presence: CIN is complete only with BOTH faces (recto + verso)', async () => {
      const { target } = await seedDoc('cin', 1);
      await seedDoc('cin', 2, target);
      mockSession(adminId);
      expect(await presenceOf(target)).toEqual({ registration: false, cin: true, bank: false });
    });
  });
});
