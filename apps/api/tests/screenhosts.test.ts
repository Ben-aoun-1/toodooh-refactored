import { eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import { type NewUser, screenhosts, users } from '../src/db/schema.js';
import { decryptWifiPassword, encryptWifiPassword } from '../src/lib/wifi-crypto.js';
import { screenhostsRoutes } from '../src/routes/screenhosts.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// The wedooh re-push (S-T1 Edge B2) is mocked so we can assert the CALL-SITE decision: an
// approved owner's WiFi edit re-pushes; an unapproved owner's edit must NOT (preserving the
// invariant that admin approval is the only way a location enters wedooh). The sync env is
// UNSET in tests, so the real fn no-ops regardless — the mock isolates the gate, not the wire.
const pushSpy = vi.hoisted(() =>
  vi.fn<(ownerId: string, logger: unknown) => Promise<void>>(() => Promise.resolve()),
);
vi.mock('../src/lib/wedooh-sync.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/wedooh-sync.js')>();
  return { ...actual, pushApprovedOwnerLocations: pushSpy };
});

type GetSessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;

const buildApp = () => Fastify({ logger: false });

const mockSession = (userId: string, role = 'individual_owner', status = 'approved'): void => {
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
      email: `sh${seq}@example.com`,
      contactName: `User ${seq}`,
      status: 'approved',
      ...values,
    })
    .returning();
  return u?.id ?? '';
};

const seedScreenhost = async (
  ownerId: string,
  opts: { name?: string; ssid?: string | null; password?: string | null } = {},
): Promise<string> => {
  const [s] = await db
    .insert(screenhosts)
    .values({
      name: opts.name ?? 'Café Test',
      ownerId,
      wifiSsid: opts.ssid ?? null,
      wifiPasswordEncrypted: opts.password ? encryptWifiPassword(opts.password) : null,
    })
    .returning();
  return s?.id ?? '';
};

const readScreenhost = async (id: string): Promise<typeof screenhosts.$inferSelect | undefined> => {
  const [s] = await db.select().from(screenhosts).where(eq(screenhosts.id, id)).limit(1);
  return s;
};

describe('screenhost WiFi (owner + admin, real Postgres)', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    await resetAuthTables();
    pushSpy.mockReset();
    pushSpy.mockResolvedValue(undefined);
    app = buildApp();
    await app.register(screenhostsRoutes);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await sql.end();
  });

  // ── GET /api/screenhosts/mine ───────────────────────────────────────────────
  it('lists the caller’s screenhosts as {id,name,wifi_ssid,wifi_password_set} and never the password', async () => {
    const ownerId = await seedUser();
    await seedScreenhost(ownerId, { name: 'Café A', ssid: 'NET-A', password: 'secret-a' });
    await seedScreenhost(ownerId, { name: 'Café B', ssid: null, password: null });
    mockSession(ownerId);

    const res = await app.inject({ method: 'GET', url: '/api/screenhosts/mine' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<{
      id: string;
      name: string;
      wifi_ssid: string | null;
      wifi_password_set: boolean;
    }>;
    expect(body).toHaveLength(2);
    const a = body.find((r) => r.name === 'Café A');
    const b = body.find((r) => r.name === 'Café B');
    expect(a).toMatchObject({ wifi_ssid: 'NET-A', wifi_password_set: true });
    expect(b).toMatchObject({ wifi_ssid: null, wifi_password_set: false });
    // The plaintext password must never cross the wire, and the shape must expose only the
    // presence flag — no `wifi_password` / ciphertext field. H2 added the venue's opening hours
    // to this list (the owner settings' Horaires editor reads them here), SCR-DECL1 the declared
    // screens and rooms (the « Écrans et salles » cards).
    expect(JSON.stringify(body)).not.toContain('secret-a');
    for (const r of body) {
      expect(Object.keys(r).sort()).toEqual([
        'closing_hour',
        'id',
        'name',
        'opening_hour',
        'room_count',
        'screen_count',
        'wifi_password_set',
        'wifi_ssid',
      ]);
    }
  });

  it('returns only the caller’s own screenhosts, not other owners’', async () => {
    const me = await seedUser();
    const other = await seedUser();
    await seedScreenhost(me, { name: 'Mine' });
    await seedScreenhost(other, { name: 'Theirs' });
    mockSession(me);

    const res = await app.inject({ method: 'GET', url: '/api/screenhosts/mine' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<{ name: string }>;
    expect(body.map((r) => r.name)).toEqual(['Mine']);
  });

  it('requires authentication (401)', async () => {
    mockNoSession();
    const res = await app.inject({ method: 'GET', url: '/api/screenhosts/mine' });
    expect(res.statusCode).toBe(401);
  });

  // ── PATCH /api/screenhosts/:id/wifi (owner) ─────────────────────────────────
  it('owner updates SSID + password on their own screenhost (200, re-encrypted, no plaintext returned)', async () => {
    const ownerId = await seedUser();
    const shId = await seedScreenhost(ownerId, { ssid: 'OLD', password: 'old-pass' });
    const before = await readScreenhost(shId);
    mockSession(ownerId);

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/screenhosts/${shId}/wifi`,
      payload: { wifi_ssid: 'NEW-SSID', wifi_password: 'new-pass' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body).toMatchObject({ wifi_ssid: 'NEW-SSID', wifi_password_set: true });
    // Neither the new plaintext nor a raw password/ciphertext field is ever returned.
    expect(JSON.stringify(body)).not.toContain('new-pass');
    expect(Object.keys(body).sort()).toEqual(['id', 'name', 'wifi_password_set', 'wifi_ssid']);

    const after = await readScreenhost(shId);
    expect(after?.wifiSsid).toBe('NEW-SSID');
    expect(after?.wifiPasswordEncrypted).not.toBe(before?.wifiPasswordEncrypted);
    expect(decryptWifiPassword(after?.wifiPasswordEncrypted ?? '')).toBe('new-pass');
  });

  it('returns 404 when patching another owner’s screenhost (owner-scope)', async () => {
    const me = await seedUser();
    const other = await seedUser();
    const foreign = await seedScreenhost(other, { password: 'theirs' });
    mockSession(me);

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/screenhosts/${foreign}/wifi`,
      payload: { wifi_password: 'hijack' },
    });
    expect(res.statusCode).toBe(404);
    // Untouched.
    expect(decryptWifiPassword((await readScreenhost(foreign))?.wifiPasswordEncrypted ?? '')).toBe(
      'theirs',
    );
  });

  it('leaves the existing ciphertext unchanged when the password is blank', async () => {
    const ownerId = await seedUser();
    const shId = await seedScreenhost(ownerId, { ssid: 'OLD', password: 'keep-me' });
    const before = await readScreenhost(shId);
    mockSession(ownerId);

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/screenhosts/${shId}/wifi`,
      payload: { wifi_ssid: 'RENAMED', wifi_password: '' },
    });
    expect(res.statusCode).toBe(200);

    const after = await readScreenhost(shId);
    expect(after?.wifiSsid).toBe('RENAMED');
    expect(after?.wifiPasswordEncrypted).toBe(before?.wifiPasswordEncrypted);
  });

  it('clears the ciphertext on an explicit null password', async () => {
    const ownerId = await seedUser();
    const shId = await seedScreenhost(ownerId, { password: 'erase-me' });
    mockSession(ownerId);

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/screenhosts/${shId}/wifi`,
      payload: { wifi_password: null },
    });
    expect(res.statusCode).toBe(200);
    const after = await readScreenhost(shId);
    expect(after?.wifiPasswordEncrypted).toBeNull();
    expect((res.json() as { wifi_password_set: boolean }).wifi_password_set).toBe(false);
  });

  it('rejects an empty body (400)', async () => {
    const ownerId = await seedUser();
    const shId = await seedScreenhost(ownerId);
    mockSession(ownerId);

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/screenhosts/${shId}/wifi`,
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it('an APPROVED owner’s edit fires the wedooh re-push with their ownerId', async () => {
    const ownerId = await seedUser({ status: 'approved' });
    const shId = await seedScreenhost(ownerId, { password: 'p' });
    mockSession(ownerId, 'individual_owner', 'approved');

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/screenhosts/${shId}/wifi`,
      payload: { wifi_password: 'changed' },
    });
    expect(res.statusCode).toBe(200);
    expect(pushSpy).toHaveBeenCalledTimes(1);
    expect(pushSpy.mock.calls[0]?.[0]).toBe(ownerId);
  });

  it('a PENDING owner’s edit does NOT fire the re-push', async () => {
    const ownerId = await seedUser({ status: 'pending' });
    const shId = await seedScreenhost(ownerId, { password: 'p' });
    mockSession(ownerId, 'individual_owner', 'pending');

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/screenhosts/${shId}/wifi`,
      payload: { wifi_password: 'changed' },
    });
    expect(res.statusCode).toBe(200);
    expect(pushSpy).not.toHaveBeenCalled();
  });

  // ── GET /api/screenhosts/:id/wifi/reveal (owner) ────────────────────────────
  it('owner reveals their OWN screenhost password — round-trips what PATCH set (200)', async () => {
    const ownerId = await seedUser();
    const shId = await seedScreenhost(ownerId, { password: 'original' });
    mockSession(ownerId);

    // What PATCH writes is exactly what reveal returns (encrypt → decrypt round-trip).
    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/screenhosts/${shId}/wifi`,
      payload: { wifi_password: 'rotated-secret' },
    });
    expect(patch.statusCode).toBe(200);

    const res = await app.inject({ method: 'GET', url: `/api/screenhosts/${shId}/wifi/reveal` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body).toEqual({ wifi_password: 'rotated-secret' });
    // The reveal shape is exactly { wifi_password } — no ciphertext or other column leaks.
    expect(Object.keys(body)).toEqual(['wifi_password']);
  });

  it('owner reveal returns { wifi_password: null } when no password is set', async () => {
    const ownerId = await seedUser();
    const shId = await seedScreenhost(ownerId, { ssid: 'NET', password: null });
    mockSession(ownerId);

    const res = await app.inject({ method: 'GET', url: `/api/screenhosts/${shId}/wifi/reveal` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ wifi_password: null });
  });

  it('owner reveal of ANOTHER owner’s screenhost → 404 (owner-scope, no leak)', async () => {
    const me = await seedUser();
    const other = await seedUser();
    const foreign = await seedScreenhost(other, { password: 'theirs' });
    mockSession(me);

    const res = await app.inject({ method: 'GET', url: `/api/screenhosts/${foreign}/wifi/reveal` });
    expect(res.statusCode).toBe(404);
    expect(JSON.stringify(res.json())).not.toContain('theirs');
  });

  it('owner reveal requires authentication (401)', async () => {
    const ownerId = await seedUser();
    const shId = await seedScreenhost(ownerId, { password: 'p' });
    mockNoSession();

    const res = await app.inject({ method: 'GET', url: `/api/screenhosts/${shId}/wifi/reveal` });
    expect(res.statusCode).toBe(401);
  });

  it('a REJECTED owner cannot reveal (403, ownerGuard)', async () => {
    const ownerId = await seedUser({ status: 'rejected' });
    const shId = await seedScreenhost(ownerId, { password: 'p' });
    mockSession(ownerId, 'individual_owner', 'rejected');

    const res = await app.inject({ method: 'GET', url: `/api/screenhosts/${shId}/wifi/reveal` });
    expect(res.statusCode).toBe(403);
  });

  it('a BANNED owner cannot reveal (403, ownerGuard)', async () => {
    const ownerId = await seedUser({ status: 'banned' });
    const shId = await seedScreenhost(ownerId, { password: 'p' });
    mockSession(ownerId, 'individual_owner', 'banned');

    const res = await app.inject({ method: 'GET', url: `/api/screenhosts/${shId}/wifi/reveal` });
    expect(res.statusCode).toBe(403);
  });

  // ── PATCH /api/admin/screenhosts/:id/wifi (admin) ───────────────────────────
  it('admin updates WiFi on ANY screenhost (200, re-encrypted)', async () => {
    const ownerId = await seedUser({ status: 'approved' });
    const shId = await seedScreenhost(ownerId, { password: 'owner-pass' });
    const adminId = await seedUser({ role: 'superadmin' });
    mockSession(adminId, 'superadmin', 'approved');

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/admin/screenhosts/${shId}/wifi`,
      payload: { wifi_ssid: 'ADMIN-SET', wifi_password: 'admin-pass' },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { wifi_ssid: string }).wifi_ssid).toBe('ADMIN-SET');

    const after = await readScreenhost(shId);
    expect(decryptWifiPassword(after?.wifiPasswordEncrypted ?? '')).toBe('admin-pass');
  });

  it('admin edit fires the re-push for the screenhost’s APPROVED owner', async () => {
    const ownerId = await seedUser({ status: 'approved' });
    const shId = await seedScreenhost(ownerId, { password: 'p' });
    const adminId = await seedUser({ role: 'superadmin' });
    mockSession(adminId, 'superadmin', 'approved');

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/admin/screenhosts/${shId}/wifi`,
      payload: { wifi_password: 'changed' },
    });
    expect(res.statusCode).toBe(200);
    expect(pushSpy).toHaveBeenCalledTimes(1);
    expect(pushSpy.mock.calls[0]?.[0]).toBe(ownerId);
  });

  it('admin edit on a PENDING owner’s screenhost does NOT fire the re-push', async () => {
    const ownerId = await seedUser({ status: 'pending' });
    const shId = await seedScreenhost(ownerId, { password: 'p' });
    const adminId = await seedUser({ role: 'superadmin' });
    mockSession(adminId, 'superadmin', 'approved');

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/admin/screenhosts/${shId}/wifi`,
      payload: { wifi_password: 'changed' },
    });
    expect(res.statusCode).toBe(200);
    expect(pushSpy).not.toHaveBeenCalled();
  });

  it('forbids a non-admin from the admin WiFi route (403)', async () => {
    const ownerId = await seedUser();
    const shId = await seedScreenhost(ownerId);
    const intruder = await seedUser();
    mockSession(intruder, 'individual_owner', 'approved');

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/admin/screenhosts/${shId}/wifi`,
      payload: { wifi_password: 'nope' },
    });
    expect(res.statusCode).toBe(403);
  });

  // ── GET /api/admin/screenhosts/:id/wifi/reveal (admin) ──────────────────────
  it('admin reveals ANY screenhost’s password (200, round-trips the stored secret)', async () => {
    const ownerId = await seedUser({ status: 'approved' });
    const shId = await seedScreenhost(ownerId, { password: 'owner-secret' });
    const adminId = await seedUser({ role: 'superadmin' });
    mockSession(adminId, 'superadmin', 'approved');

    const res = await app.inject({
      method: 'GET',
      url: `/api/admin/screenhosts/${shId}/wifi/reveal`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ wifi_password: 'owner-secret' });
  });

  it('admin reveal returns null when the screenhost has no password', async () => {
    const ownerId = await seedUser();
    const shId = await seedScreenhost(ownerId, { password: null });
    const adminId = await seedUser({ role: 'superadmin' });
    mockSession(adminId, 'superadmin', 'approved');

    const res = await app.inject({
      method: 'GET',
      url: `/api/admin/screenhosts/${shId}/wifi/reveal`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ wifi_password: null });
  });

  it('forbids a non-admin from the admin reveal route (403)', async () => {
    const ownerId = await seedUser();
    const shId = await seedScreenhost(ownerId, { password: 'secret' });
    const intruder = await seedUser();
    mockSession(intruder, 'individual_owner', 'approved');

    const res = await app.inject({
      method: 'GET',
      url: `/api/admin/screenhosts/${shId}/wifi/reveal`,
    });
    expect(res.statusCode).toBe(403);
    expect(JSON.stringify(res.json())).not.toContain('secret');
  });
});
