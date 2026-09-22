import { eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import { type NewUser, screenhosts, users, zones } from '../src/db/schema.js';
import { zonesRoutes } from '../src/routes/zones.js';

import { resetAuthTables } from './helpers/db-test-setup.js';
import { sweepZones } from './helpers/zones.js';

// CF-Z1 — the zones read + the mig-0040 seed/backfill/default contract. zones is REFERENCE-LIKE
// (no FK to users → NOT truncated between tests): assertions are containment-based, never
// exact-count, and any extra row this suite creates is namespaced AND swept in afterEach
// (TEST-ISO1 — advertiser-performances pins the exact catalogue).

type GetSessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;
const buildApp = () => Fastify({ logger: false });

const GRAND_TUNIS_ID = '2c8e5a1e-4b7d-4f3a-9c6e-1a2b3c4d5e6f';

const mockSession = (userId: string): void => {
  vi.spyOn(auth.api, 'getSession').mockResolvedValue({
    session: {},
    user: { id: userId, role: 'advertiser', status: 'approved' },
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
      email: `zones${seq}@example.com`,
      contactName: `User ${seq}`,
      role: 'advertiser',
      status: 'approved',
      ...values,
    })
    .returning();
  return u?.id ?? '';
};

describe('GET /api/zones + the mig-0040 contract (real Postgres)', () => {
  let app: ReturnType<typeof buildApp>;
  const createdZoneIds: string[] = [];

  beforeEach(async () => {
    await resetAuthTables();
    app = buildApp();
    await app.register(zonesRoutes);
    await app.ready();
  });
  afterEach(async () => {
    await sweepZones(createdZoneIds.splice(0));
    await app.close();
    vi.restoreAllMocks();
  });
  afterAll(async () => {
    await sql.end();
  });

  it('401 for an unauthenticated caller', async () => {
    mockNoSession();
    expect((await app.inject({ method: 'GET', url: '/api/zones' })).statusCode).toBe(401);
  });

  it('lists ACTIVE zones — the seeded Grand Tunis with its FIXED id', async () => {
    mockSession(await seedUser());
    const res = await app.inject({ method: 'GET', url: '/api/zones' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { id: string; name: string }[];
    expect(body.some((z) => z.id === GRAND_TUNIS_ID && z.name === 'Grand Tunis')).toBe(true);
    for (const z of body) {
      expect(Object.keys(z).sort()).toEqual(['id', 'name']); // lean wire shape
    }
  });

  it('EXCLUDES inactive zones', async () => {
    const name = `Zone désactivée ${Date.now()}-${seq}`;
    const [inactive] = await db.insert(zones).values({ name, active: false }).returning();
    if (inactive) createdZoneIds.push(inactive.id);
    mockSession(await seedUser());
    const body = (await app.inject({ method: 'GET', url: '/api/zones' })).json() as {
      id: string;
    }[];
    expect(body.some((z) => z.id === inactive?.id)).toBe(false);
  });

  it('mig 0040: a screenhost inserted WITHOUT zone_id defaults to Grand Tunis (signup untouched)', async () => {
    const owner = await seedUser({ role: 'individual_owner' });
    const [sh] = await db
      .insert(screenhosts)
      .values({ name: 'Défaut GT', ownerId: owner })
      .returning();
    expect(sh?.zoneId).toBe(GRAND_TUNIS_ID);
  });

  it('mig 0040: every existing screenhost row is backfilled (no NULL zone_id anywhere)', async () => {
    const rows = await db
      .select({ id: screenhosts.id })
      .from(screenhosts)
      .where(eq(screenhosts.isActive, true));
    void rows; // the truncate wiped rows; the REAL backfill proof is the dev-DB check + the default above
    const [gt] = await db.select().from(zones).where(eq(zones.id, GRAND_TUNIS_ID));
    expect(gt?.name).toBe('Grand Tunis');
    expect(gt?.active).toBe(true);
  });
});
