import { eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import { type NewUser, users } from '../src/db/schema.js';
import { adminRoutes } from '../src/routes/admin.js';
import { storage } from '../src/storage/s3-storage.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

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
        bankDocUrl: 'bank/seeded',
        bankDetailsUpdatedAt: new Date('2026-06-01T00:00:00Z'),
      });
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

    it('happy → rejected + trio, onboarding_completed untouched', async () => {
      const target = await seedUser({ status: 'pending', onboardingCompleted: false });
      mockSession(adminId);
      const res = await reject(target, { notes: 'missing CIN' });
      expect(res.statusCode).toBe(200);
      const [row] = await db.select().from(users).where(eq(users.id, target));
      expect(row?.status).toBe('rejected');
      expect(row?.validatedBy).toBe(adminId);
      expect(row?.validatedAt).not.toBeNull();
      expect(row?.validationNotes).toBe('missing CIN');
      expect(row?.onboardingCompleted).toBe(false);
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
      const res = await reject(NO_ROW_ID, { notes: 'x' });
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
      const res = await reject(target, { notes: 'again' });
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

  describe('GET /api/admin/users/:id/documents/:type (real Postgres + MinIO)', () => {
    const pdf = Buffer.from('%PDF-1.4 fake admin-review bytes');
    const uploadedKeys: string[] = [];

    afterEach(async () => {
      for (const key of uploadedKeys) await storage.delete({ key }).catch(() => undefined);
      uploadedKeys.length = 0;
    });

    const getDoc = (id: string, type: string) =>
      app.inject({ method: 'GET', url: `/api/admin/users/${id}/documents/${type}` });

    const seedDoc = async (type: 'rne' | 'cin' | 'bank'): Promise<string> => {
      const target = await seedUser({ status: 'pending' });
      const key = `${type}/${target}`;
      await storage.upload({ key, body: pdf, contentType: 'application/pdf' });
      uploadedKeys.push(key);
      await db
        .update(users)
        .set(
          type === 'rne'
            ? { registrationDocUrl: key }
            : type === 'cin'
              ? { cinDocUrl: key }
              : { bankDocUrl: key },
        )
        .where(eq(users.id, target));
      return target;
    };

    it('rne → 200 { url } fetching the uploaded bytes', async () => {
      const target = await seedDoc('rne');
      mockSession(adminId);
      const res = await getDoc(target, 'rne');
      expect(res.statusCode).toBe(200);
      const fetched = Buffer.from(
        await (await fetch(res.json<{ url: string }>().url)).arrayBuffer(),
      );
      expect(fetched.equals(pdf)).toBe(true);
    });

    it('cin → 200 { url }', async () => {
      const target = await seedDoc('cin');
      mockSession(adminId);
      expect((await getDoc(target, 'cin')).statusCode).toBe(200);
    });

    it('bank → 200 { url } (F6 — admin bank-details review)', async () => {
      const target = await seedDoc('bank');
      mockSession(adminId);
      expect((await getDoc(target, 'bank')).statusCode).toBe(200);
    });

    it('null key → 404 DOCUMENT_NOT_UPLOADED', async () => {
      const target = await seedUser({ status: 'pending' });
      mockSession(adminId);
      const res = await getDoc(target, 'cin');
      expect(res.statusCode).toBe(404);
      const body = res.json<{ error: string; documentType: string }>();
      expect(body.error).toBe('DOCUMENT_NOT_UPLOADED');
      expect(body.documentType).toBe('cin');
    });

    it('bank with no document on file → 404 DOCUMENT_NOT_UPLOADED', async () => {
      const target = await seedUser({ status: 'pending' });
      mockSession(adminId);
      const res = await getDoc(target, 'bank');
      expect(res.statusCode).toBe(404);
      const body = res.json<{ error: string; documentType: string }>();
      expect(body.error).toBe('DOCUMENT_NOT_UPLOADED');
      expect(body.documentType).toBe('bank');
    });

    it('unknown user → 404 USER_NOT_FOUND', async () => {
      mockSession(adminId);
      const res = await getDoc(NO_ROW_ID, 'rne');
      expect(res.statusCode).toBe(404);
      expect(res.json<{ error: string }>().error).toBe('USER_NOT_FOUND');
    });

    it('invalid type → 400', async () => {
      const target = await seedUser({ status: 'pending' });
      mockSession(adminId);
      expect((await getDoc(target, 'passport')).statusCode).toBe(400);
    });

    it('non-admin → 403', async () => {
      const target = await seedUser({ status: 'pending' });
      mockSession(adminId, 'advertiser');
      expect((await getDoc(target, 'rne')).statusCode).toBe(403);
    });
  });
});
