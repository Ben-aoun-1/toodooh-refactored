import { eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import { type NewUser, businessSectors, screenhosts, users } from '../src/db/schema.js';
import { screenhostsRoutes } from '../src/routes/screenhosts.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// Integration suite — real Postgres. getSession is mocked to drive the admin identity. Admin sets a
// venue's L-disp eligibility (category/class/horaires/capacity); SPS is defaulted (50) + not settable.
type GetSessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;
type Eligibility = {
  business_sector_id: string | null;
  class: string | null;
  opening_hour: number | null;
  closing_hour: number | null;
  broadcast_capacity: number | null;
  sps: number;
};

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
      email: `elig${seq}@example.com`,
      contactName: `User ${seq}`,
      status: 'approved',
      ...values,
    })
    .returning();
  return u?.id ?? '';
};

const seedScreenhost = async (ownerId: string | null = null): Promise<string> => {
  const [s] = await db.insert(screenhosts).values({ name: 'Café Test', ownerId }).returning();
  return s?.id ?? '';
};

const sectorId = async (audience: 'owner' | 'advertiser'): Promise<string> => {
  const [s] = await db
    .select({ id: businessSectors.id })
    .from(businessSectors)
    .where(eq(businessSectors.audience, audience))
    .limit(1);
  return s?.id ?? '';
};

describe('admin screenhost eligibility (L-inv, real Postgres)', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    await resetAuthTables();
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

  const get = (id: string) =>
    app.inject({ method: 'GET', url: `/api/admin/screenhosts/${id}/eligibility` });
  const patch = (id: string, payload: Record<string, unknown>) =>
    app.inject({ method: 'PATCH', url: `/api/admin/screenhosts/${id}/eligibility`, payload });

  it('GET returns the defaults for a fresh screenhost (eligibility null, SPS baseline 50)', async () => {
    const admin = await seedUser({ role: 'admin' });
    const sh = await seedScreenhost();
    mockSession(admin);
    const res = await get(sh);
    expect(res.statusCode).toBe(200);
    const body = res.json() as Eligibility;
    expect(body).toMatchObject({
      business_sector_id: null,
      class: null,
      opening_hour: null,
      closing_hour: null,
      broadcast_capacity: null,
      sps: 50,
    });
  });

  it('PATCH sets category/class/horaires/capacity (200); GET reflects them', async () => {
    const admin = await seedUser({ role: 'admin' });
    const sh = await seedScreenhost();
    const cat = await sectorId('owner');
    mockSession(admin);

    const res = await patch(sh, {
      business_sector_id: cat,
      class: 'premium',
      opening_hour: 8,
      closing_hour: 23,
      broadcast_capacity: 4,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json() as Eligibility).toMatchObject({
      business_sector_id: cat,
      class: 'premium',
      opening_hour: 8,
      closing_hour: 23,
      broadcast_capacity: 4,
      sps: 50,
    });

    const got = (await get(sh)).json() as Eligibility;
    expect(got.class).toBe('premium');
    expect(got.broadcast_capacity).toBe(4);
  });

  it('PATCH with null clears a field', async () => {
    const admin = await seedUser({ role: 'admin' });
    const sh = await seedScreenhost();
    const cat = await sectorId('owner');
    mockSession(admin);
    await patch(sh, { business_sector_id: cat, class: 'moyen' });
    const res = await patch(sh, { business_sector_id: null });
    expect(res.statusCode).toBe(200);
    expect((res.json() as Eligibility).business_sector_id).toBeNull();
    expect((res.json() as Eligibility).class).toBe('moyen'); // untouched
  });

  // ── E7 / EL1 rider — the hour-pair refines close the raw-API incoherent-hours hole. The PATCH
  // is PARTIAL, so the rules apply to the RESULTING state (stored ⊕ patch), never the bare body:
  // a one-sided patch whose RESULT is a coherent window stays legal (the EL1 dirty-fields editor
  // sends exactly those), while any patch whose result is half-set or inverted is a 400 with the
  // owner /hours route's messages.
  describe('hour-pair refines on the RESULTING state (EL1 rider)', () => {
    it('rejects an ouverture whose result has no fermeture (set-together)', async () => {
      const admin = await seedUser({ role: 'admin' });
      const sh = await seedScreenhost();
      mockSession(admin);
      const res = await patch(sh, { opening_hour: 8 });
      expect(res.statusCode).toBe(400);
      expect(res.json().fields).toEqual([
        {
          field: 'closing_hour',
          reason: 'opening_hour and closing_hour must be set together or both null',
        },
      ]);
    });

    it('rejects a fermeture whose result has no ouverture (set-together)', async () => {
      const admin = await seedUser({ role: 'admin' });
      const sh = await seedScreenhost();
      mockSession(admin);
      const res = await patch(sh, { closing_hour: 22 });
      expect(res.statusCode).toBe(400);
      expect(res.json().fields[0].field).toBe('closing_hour');
    });

    it('rejects a one-sided null that strands the other bound', async () => {
      const admin = await seedUser({ role: 'admin' });
      const sh = await seedScreenhost();
      mockSession(admin);
      await patch(sh, { opening_hour: 8, closing_hour: 18 });
      const res = await patch(sh, { opening_hour: null });
      expect(res.statusCode).toBe(400);
    });

    it('rejects a result with ouverture ≥ fermeture (strict order, body × stored)', async () => {
      const admin = await seedUser({ role: 'admin' });
      const sh = await seedScreenhost();
      mockSession(admin);
      // Both in the body, inverted.
      const both = await patch(sh, { opening_hour: 22, closing_hour: 8 });
      expect(both.statusCode).toBe(400);
      expect(both.json().fields).toEqual([
        { field: 'closing_hour', reason: 'opening_hour must be strictly before closing_hour' },
      ]);
      // Equal pair.
      expect((await patch(sh, { opening_hour: 8, closing_hour: 8 })).statusCode).toBe(400);
      // One-sided against the STORED other bound.
      await patch(sh, { opening_hour: 8, closing_hour: 18 });
      expect((await patch(sh, { opening_hour: 20 })).statusCode).toBe(400);
    });

    it('accepts a one-sided patch whose RESULT is coherent (the EL1 dirty-fields case)', async () => {
      const admin = await seedUser({ role: 'admin' });
      const sh = await seedScreenhost();
      mockSession(admin);
      await patch(sh, { opening_hour: 8, closing_hour: 18 });
      const res = await patch(sh, { opening_hour: 9 });
      expect(res.statusCode).toBe(200);
      expect((res.json() as Eligibility).opening_hour).toBe(9);
      expect((res.json() as Eligibility).closing_hour).toBe(18);
    });

    it('accepts the both-null clear and the coherent full pair', async () => {
      const admin = await seedUser({ role: 'admin' });
      const sh = await seedScreenhost();
      mockSession(admin);
      await patch(sh, { opening_hour: 8, closing_hour: 18 });
      const cleared = await patch(sh, { opening_hour: null, closing_hour: null });
      expect(cleared.statusCode).toBe(200);
      expect((cleared.json() as Eligibility).opening_hour).toBeNull();
      expect((cleared.json() as Eligibility).closing_hour).toBeNull();
    });
  });

  it('rejects an invalid class (400)', async () => {
    const admin = await seedUser({ role: 'admin' });
    const sh = await seedScreenhost();
    mockSession(admin);
    expect((await patch(sh, { class: 'luxe' })).statusCode).toBe(400);
  });

  it('rejects an advertiser-audience sector as the category (owner-only) (400)', async () => {
    const admin = await seedUser({ role: 'admin' });
    const sh = await seedScreenhost();
    const advCat = await sectorId('advertiser');
    mockSession(admin);
    expect((await patch(sh, { business_sector_id: advCat })).statusCode).toBe(400);
  });

  it('rejects a nonexistent category (400)', async () => {
    const admin = await seedUser({ role: 'admin' });
    const sh = await seedScreenhost();
    mockSession(admin);
    expect(
      (await patch(sh, { business_sector_id: '00000000-0000-0000-0000-000000000000' })).statusCode,
    ).toBe(400);
  });

  it('rejects an out-of-range hour and a non-positive capacity (400)', async () => {
    const admin = await seedUser({ role: 'admin' });
    const sh = await seedScreenhost();
    mockSession(admin);
    expect((await patch(sh, { opening_hour: 24 })).statusCode).toBe(400);
    expect((await patch(sh, { broadcast_capacity: 0 })).statusCode).toBe(400);
  });

  it('rejects an empty patch body (400)', async () => {
    const admin = await seedUser({ role: 'admin' });
    const sh = await seedScreenhost();
    mockSession(admin);
    expect((await patch(sh, {})).statusCode).toBe(400);
  });

  it('returns 404 for a nonexistent screenhost (GET + PATCH)', async () => {
    const admin = await seedUser({ role: 'admin' });
    const missing = '00000000-0000-0000-0000-000000000000';
    mockSession(admin);
    expect((await get(missing)).statusCode).toBe(404);
    expect((await patch(missing, { class: 'premium' })).statusCode).toBe(404);
  });

  it('forbids a non-admin (403)', async () => {
    const owner = await seedUser({ role: 'individual_owner' });
    const sh = await seedScreenhost(owner);
    mockSession(owner, 'individual_owner');
    expect((await get(sh)).statusCode).toBe(403);
    expect((await patch(sh, { class: 'premium' })).statusCode).toBe(403);
  });
});
