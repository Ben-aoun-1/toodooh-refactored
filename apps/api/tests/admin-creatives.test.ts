import { eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import { type Creative, type NewUser, creatives, users, campaigns } from '../src/db/schema.js';
import { adminCreativesRoutes } from '../src/routes/admin-creatives.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// Integration suite — real Postgres. getSession is mocked to drive the admin identity. The presign
// URL route signs OFFLINE (no MinIO object required). Moderation flips validation_status + stamps
// the audit trio; mirrors the admin account/document review (admin.ts).
type GetSessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;

const buildApp = () => Fastify({ logger: false });

const mockSession = (userId: string, role = 'admin', status = 'approved'): void => {
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
      email: `adcr${seq}@example.com`,
      contactName: `User ${seq}`,
      role: 'advertiser',
      status: 'approved',
      ...values,
    })
    .returning();
  return u?.id ?? '';
};

const seedCreative = async (
  advertiserId: string,
  opts: { type?: 'video' | 'photo'; status?: 'pending' | 'approved' | 'rejected' } = {},
): Promise<Creative> => {
  seq += 1;
  const [c] = await db
    .insert(creatives)
    .values({
      advertiserId,
      creativeType: opts.type ?? 'video',
      storageKey: `creatives/${advertiserId}/seed${seq}`,
      durationSeconds: 20,
      validationStatus: opts.status ?? 'pending',
    })
    .returning();
  if (!c) throw new Error('seedCreative failed');
  return c;
};

describe('admin creative moderation (real Postgres)', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    await resetAuthTables();
    app = buildApp();
    await app.register(adminCreativesRoutes);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await sql.end();
  });

  it('forbids a non-admin (advertiser) from the moderation queue (403)', async () => {
    const advertiser = await seedUser();
    mockSession(advertiser, 'advertiser');
    const res = await app.inject({ method: 'GET', url: '/api/admin/creatives' });
    expect(res.statusCode).toBe(403);
  });

  it('lists the moderation queue and filters by status (CF-HF4: pending rows queue at PANIER-ADD)', async () => {
    const adv = await seedUser();
    const p1 = await seedCreative(adv, { status: 'pending' });
    const p2 = await seedCreative(adv, { status: 'pending' });
    await seedCreative(adv, { status: 'approved' });
    // CF-HF4 — a pending creative enters the queue only once a linking campaign reaches the
    // cart or goes beyond draft; these two are SUBMITTED via a pending campaign each.
    for (const cr of [p1, p2]) {
      await db.insert(campaigns).values({
        advertiserId: adv,
        name: `Queue ${cr.id.slice(0, 8)}`,
        campaignType: 'standard',
        status: 'pending',
        creativeId: cr.id,
      });
    }
    // …and an UNSUBMITTED orphan stays out of the queue entirely.
    await seedCreative(adv, { status: 'pending' });
    const admin = await seedUser({ role: 'admin' });
    mockSession(admin);

    const all = await app.inject({ method: 'GET', url: '/api/admin/creatives' });
    expect(all.statusCode).toBe(200);
    expect((all.json() as unknown[]).length).toBe(3); // the orphan is invisible

    const pending = await app.inject({ method: 'GET', url: '/api/admin/creatives?status=pending' });
    expect((pending.json() as unknown[]).length).toBe(2);
  });

  // ADM-FIX1 — the « Annonceur » column was a raw uuid. Every row now carries the NAME beside it
  // (business_name, else contact_name); the id survives as the muted support line.
  it('names the advertiser on every queue row (business_name, else contact_name)', async () => {
    const withBusiness = await seedUser({ contactName: 'Amine', businessName: 'Société Mejri' });
    const withoutBusiness = await seedUser({ contactName: 'Salma Trabelsi' });
    const cr1 = await seedCreative(withBusiness, { status: 'pending' });
    const cr2 = await seedCreative(withoutBusiness, { status: 'pending' });
    for (const [advertiserId, cr] of [
      [withBusiness, cr1],
      [withoutBusiness, cr2],
    ] as const) {
      await db.insert(campaigns).values({
        advertiserId,
        name: `Queue ${cr.id.slice(0, 8)}`,
        campaignType: 'standard',
        status: 'pending',
        creativeId: cr.id,
      });
    }
    const admin = await seedUser({ role: 'admin' });
    mockSession(admin);

    const res = await app.inject({ method: 'GET', url: '/api/admin/creatives' });
    expect(res.statusCode).toBe(200);
    const rows = res.json() as { id: string; advertiser_id: string; advertiser_label: string }[];
    const row1 = rows.find((r) => r.id === cr1.id);
    expect(row1?.advertiser_label).toBe('Société Mejri');
    expect(row1?.advertiser_id).toBe(withBusiness);
    expect(rows.find((r) => r.id === cr2.id)?.advertiser_label).toBe('Salma Trabelsi');
    // The join must not drop rows: both creatives are still listed.
    expect(rows).toHaveLength(2);
  });

  it('the approve/reject responses carry the advertiser label too', async () => {
    const adv = await seedUser({ contactName: 'Nizar', businessName: 'ACME Média' });
    const creative = await seedCreative(adv, { status: 'pending' });
    const admin = await seedUser({ role: 'admin' });
    mockSession(admin);

    const approved = await app.inject({
      method: 'POST',
      url: `/api/admin/creatives/${creative.id}/approve`,
      payload: {},
    });
    expect(approved.statusCode).toBe(200);
    expect((approved.json() as { advertiser_label: string }).advertiser_label).toBe('ACME Média');

    const rejected = await app.inject({
      method: 'POST',
      url: `/api/admin/creatives/${creative.id}/reject`,
      payload: { notes: 'hors charte' },
    });
    expect(rejected.statusCode).toBe(200);
    expect((rejected.json() as { advertiser_label: string }).advertiser_label).toBe('ACME Média');
  });

  it('approves a creative → approved + stamps the audit trio (200)', async () => {
    const adv = await seedUser();
    const creative = await seedCreative(adv);
    const admin = await seedUser({ role: 'admin' });
    mockSession(admin);

    const res = await app.inject({
      method: 'POST',
      url: `/api/admin/creatives/${creative.id}/approve`,
      payload: { notes: 'looks good' },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { validation_status: string }).validation_status).toBe('approved');

    const [row] = await db.select().from(creatives).where(eq(creatives.id, creative.id)).limit(1);
    expect(row?.validationStatus).toBe('approved');
    expect(row?.validatedBy).toBe(admin);
    expect(row?.validatedAt).not.toBeNull();
    expect(row?.validationNotes).toBe('looks good');
  });

  it('approves without notes (notes optional) (200)', async () => {
    const adv = await seedUser();
    const creative = await seedCreative(adv);
    const admin = await seedUser({ role: 'admin' });
    mockSession(admin);
    const res = await app.inject({
      method: 'POST',
      url: `/api/admin/creatives/${creative.id}/approve`,
    });
    expect(res.statusCode).toBe(200);
  });

  it('rejects WITHOUT a reason → 400 (notes required)', async () => {
    const adv = await seedUser();
    const creative = await seedCreative(adv);
    const admin = await seedUser({ role: 'admin' });
    mockSession(admin);
    const res = await app.inject({
      method: 'POST',
      url: `/api/admin/creatives/${creative.id}/reject`,
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    const [row] = await db.select().from(creatives).where(eq(creatives.id, creative.id)).limit(1);
    expect(row?.validationStatus).toBe('pending'); // unchanged
  });

  it('rejects WITH a reason → rejected + stores the reason (200)', async () => {
    const adv = await seedUser();
    const creative = await seedCreative(adv);
    const admin = await seedUser({ role: 'admin' });
    mockSession(admin);
    const res = await app.inject({
      method: 'POST',
      url: `/api/admin/creatives/${creative.id}/reject`,
      payload: { notes: 'contains a competitor logo' },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { validation_status: string }).validation_status).toBe('rejected');
    const [row] = await db.select().from(creatives).where(eq(creatives.id, creative.id)).limit(1);
    expect(row?.validationStatus).toBe('rejected');
    expect(row?.validationNotes).toBe('contains a competitor logo');
    expect(row?.validatedBy).toBe(admin);
  });

  it('approving/rejecting an unknown id → 404', async () => {
    const admin = await seedUser({ role: 'admin' });
    mockSession(admin);
    const missing = '00000000-0000-0000-0000-000000000000';
    expect(
      (await app.inject({ method: 'POST', url: `/api/admin/creatives/${missing}/approve` }))
        .statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/admin/creatives/${missing}/reject`,
          payload: { notes: 'x' },
        })
      ).statusCode,
    ).toBe(404);
  });

  it('presigns a creative for review (200) and 404s an unknown id', async () => {
    const adv = await seedUser();
    const creative = await seedCreative(adv);
    const admin = await seedUser({ role: 'admin' });
    mockSession(admin);
    const url = await app.inject({ method: 'GET', url: `/api/admin/creatives/${creative.id}/url` });
    expect(url.statusCode).toBe(200);
    expect((url.json() as { url: string }).url).toContain('http');
    const missing = await app.inject({
      method: 'GET',
      url: '/api/admin/creatives/00000000-0000-0000-0000-000000000000/url',
    });
    expect(missing.statusCode).toBe(404);
  });
});
