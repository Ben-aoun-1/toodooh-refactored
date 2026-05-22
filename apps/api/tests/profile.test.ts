import { eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import { businessSectors, users } from '../src/db/schema.js';
import { profileRoutes } from '../src/routes/profile.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// Integration suite — requires a real Postgres (DATABASE_URL). The session-guard's
// auth.api.getSession is mocked (its own behavior is covered by require-auth.test.ts);
// here we exercise the endpoint logic against real rows + the seeded business_sectors.
type GetSessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;

const buildApp = () => Fastify({ logger: false });

const mockSession = (userId: string): void => {
  vi.spyOn(auth.api, 'getSession').mockResolvedValue({
    session: {},
    user: { id: userId, role: 'advertiser', status: 'pending' },
  } as unknown as GetSessionResult);
};

describe('PATCH /api/profile/business', () => {
  let app: ReturnType<typeof buildApp>;
  let userId: string;
  let sectorId: string;

  beforeEach(async () => {
    await resetAuthTables();
    const [u] = await db
      .insert(users)
      .values({ email: 'biz@example.com', contactName: 'Biz Owner' })
      .returning();
    userId = u?.id ?? '';
    const [sector] = await db.select({ id: businessSectors.id }).from(businessSectors).limit(1);
    sectorId = sector?.id ?? '';
    app = buildApp();
    await app.register(profileRoutes);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await sql.end();
  });

  const patch = (payload: Record<string, unknown>) =>
    app.inject({ method: 'PATCH', url: '/api/profile/business', payload });

  it('authenticated → updates supplied fields', async () => {
    mockSession(userId);
    const res = await patch({ business_name: 'New Biz', business_type: 'agency' });
    expect(res.statusCode).toBe(200);
    const [row] = await db.select().from(users).where(eq(users.id, userId));
    expect(row?.businessName).toBe('New Biz');
    expect(row?.businessType).toBe('agency');
  });

  it('partial: only supplied fields change', async () => {
    await db
      .update(users)
      .set({ businessName: 'Original', businessType: 'local' })
      .where(eq(users.id, userId));
    mockSession(userId);
    await patch({ business_name: 'Renamed' });
    const [row] = await db.select().from(users).where(eq(users.id, userId));
    expect(row?.businessName).toBe('Renamed');
    expect(row?.businessType).toBe('local'); // untouched
  });

  it('unauthenticated → 401', async () => {
    vi.spyOn(auth.api, 'getSession').mockResolvedValue(null);
    const res = await patch({ business_name: 'X' });
    expect(res.statusCode).toBe(401);
  });

  it('empty body → 400', async () => {
    mockSession(userId);
    const res = await patch({});
    expect(res.statusCode).toBe(400);
  });

  it('unknown business_sector_id → 400 (FK pre-check)', async () => {
    mockSession(userId);
    const res = await patch({ business_sector_id: '00000000-0000-0000-0000-000000000000' });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ fields: { field: string }[] }>().fields[0]?.field).toBe('business_sector_id');
  });

  it('valid business_sector_id → stored', async () => {
    mockSession(userId);
    const res = await patch({ business_sector_id: sectorId });
    expect(res.statusCode).toBe(200);
    const [row] = await db.select().from(users).where(eq(users.id, userId));
    expect(row?.businessSectorId).toBe(sectorId);
  });

  it('tax_number: valid stored, null clears, bad format → 400', async () => {
    mockSession(userId);
    expect((await patch({ tax_number: '1234567ABC' })).statusCode).toBe(200);
    expect((await db.select().from(users).where(eq(users.id, userId)))[0]?.taxNumber).toBe(
      '1234567ABC',
    );
    expect((await patch({ tax_number: null })).statusCode).toBe(200);
    expect((await db.select().from(users).where(eq(users.id, userId)))[0]?.taxNumber).toBeNull();
    expect((await patch({ tax_number: 'ab' })).statusCode).toBe(400);
  });

  it('deferred owner-extras → ignored (stripped), not errored, not stored', async () => {
    mockSession(userId);
    const res = await patch({
      business_name: 'Owner Biz',
      number_of_screens: 5,
      number_of_rooms: 3,
      company_size: '10 - 50',
    });
    expect(res.statusCode).toBe(200);
    const [row] = await db.select().from(users).where(eq(users.id, userId));
    expect(row?.businessName).toBe('Owner Biz');
  });

  it('role/status in body → not applied (not in schema)', async () => {
    mockSession(userId);
    await patch({ business_name: 'Y', role: 'superadmin', status: 'approved' });
    const [row] = await db.select().from(users).where(eq(users.id, userId));
    expect(row?.role).toBe('advertiser');
    expect(row?.status).toBe('pending');
  });
});
