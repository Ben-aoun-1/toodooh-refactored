import { eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import { type NewUser, predefinedZones, users } from '../src/db/schema.js';
import { apiRoutes } from '../src/routes/index.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// Integration suite — real Postgres. predefined_zones carries the 8-row Phase-1c seed and is NOT
// truncated by resetAuthTables (only auth tables are), so the GET reads the seeds directly. The
// write round-trip uses a uniquely-named row and deletes it, keeping the suite idempotent across runs.
type GetSessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;
type ZoneRow = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  radius: number;
  is_active: boolean;
  image_url: string | null;
  is_hot: boolean;
  created_at: string;
};

const buildApp = () => Fastify({ logger: false });
const TEST_ZONE_NAME = 'Z1 Round-Trip Zone';

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
    .values({ email: `z${seq}@example.com`, contactName: `Z ${seq}`, ...values })
    .returning();
  return u?.id ?? '';
};

describe('predefined-zones endpoints (real Postgres)', () => {
  let app: ReturnType<typeof buildApp>;
  let adminId: string;

  beforeEach(async () => {
    await resetAuthTables();
    // Defensive cleanup: a prior crashed run could leave the uniquely-named test row (name is UNIQUE).
    await db.delete(predefinedZones).where(eq(predefinedZones.name, TEST_ZONE_NAME));
    adminId = await seedUser({ role: 'superadmin', status: 'approved' });
    app = buildApp();
    await app.register(apiRoutes);
    await app.ready();
  });

  afterEach(async () => {
    await db.delete(predefinedZones).where(eq(predefinedZones.name, TEST_ZONE_NAME));
    await app.close();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await sql.end();
  });

  describe('GET /api/predefined-zones (public)', () => {
    it('200, serves the 8 seeded rows, lat/lng as NUMBER (not string) + snake_case keys', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/predefined-zones' });
      expect(res.statusCode).toBe(200);
      const rows = res.json<ZoneRow[]>();
      // The 8-row seed is present (>= 8 tolerates any rows other suites might leave; afterEach cleans ours).
      expect(rows.length).toBeGreaterThanOrEqual(8);

      const ariana = rows.find((r) => r.name === 'Ariana');
      expect(ariana).toBeDefined();
      // LOAD-BEARING: the serializer Number()s the numeric columns. Without it Drizzle yields strings
      // and the wizard's Haversine + Leaflet-circle math breaks.
      expect(typeof ariana?.latitude).toBe('number');
      expect(typeof ariana?.longitude).toBe('number');
      expect(ariana?.latitude).toBeCloseTo(36.8625, 4);
      expect(ariana?.longitude).toBeCloseTo(10.1956, 4);
      expect(typeof ariana?.radius).toBe('number');
      // snake_case keys the PredefinedZone interface expects.
      expect(ariana).toHaveProperty('is_active');
      expect(ariana).toHaveProperty('image_url');
      expect(ariana).toHaveProperty('created_at');
    });
  });

  describe('admin-guarded writes', () => {
    it('non-admin POST → 403; no session → 401', async () => {
      mockSession(adminId, 'advertiser');
      const forbidden = await app.inject({
        method: 'POST',
        url: '/api/predefined-zones',
        payload: { name: TEST_ZONE_NAME, latitude: 36.8, longitude: 10.1, radius: 3000 },
      });
      expect(forbidden.statusCode).toBe(403);

      vi.spyOn(auth.api, 'getSession').mockResolvedValue(null);
      const unauth = await app.inject({
        method: 'POST',
        url: '/api/predefined-zones',
        payload: { name: TEST_ZONE_NAME, latitude: 36.8, longitude: 10.1, radius: 3000 },
      });
      expect(unauth.statusCode).toBe(401);
    });

    it('create → GET → delete round-trips; create returns numeric lat/lng', async () => {
      mockSession(adminId, 'superadmin');

      const created = await app.inject({
        method: 'POST',
        url: '/api/predefined-zones',
        payload: {
          name: TEST_ZONE_NAME,
          description: 'round-trip',
          latitude: 36.5,
          longitude: 10.25,
          radius: 2500,
        },
      });
      expect(created.statusCode).toBe(201);
      const zone = created.json<ZoneRow>();
      expect(typeof zone.latitude).toBe('number');
      expect(typeof zone.longitude).toBe('number');
      expect(zone.latitude).toBeCloseTo(36.5, 4);
      expect(zone.is_active).toBe(true); // defaulted by the DB

      // Present in the public GET.
      const afterCreate = await app.inject({ method: 'GET', url: '/api/predefined-zones' });
      expect(afterCreate.json<ZoneRow[]>().some((r) => r.id === zone.id)).toBe(true);

      // DELETE → 204.
      const del = await app.inject({ method: 'DELETE', url: `/api/predefined-zones/${zone.id}` });
      expect(del.statusCode).toBe(204);

      // Gone from the public GET.
      const afterDelete = await app.inject({ method: 'GET', url: '/api/predefined-zones' });
      expect(afterDelete.json<ZoneRow[]>().some((r) => r.id === zone.id)).toBe(false);
    });

    it('PATCH /:id/active toggles is_active', async () => {
      mockSession(adminId, 'superadmin');
      const created = await app.inject({
        method: 'POST',
        url: '/api/predefined-zones',
        payload: { name: TEST_ZONE_NAME, latitude: 36.5, longitude: 10.25, radius: 2500 },
      });
      const zone = created.json<ZoneRow>();

      const toggled = await app.inject({
        method: 'PATCH',
        url: `/api/predefined-zones/${zone.id}/active`,
        payload: { is_active: false },
      });
      expect(toggled.statusCode).toBe(200);
      expect(toggled.json<ZoneRow>().is_active).toBe(false);
    });

    it('PATCH /:id on a missing id → 404 ZONE_NOT_FOUND', async () => {
      mockSession(adminId, 'superadmin');
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/predefined-zones/00000000-0000-0000-0000-000000000000',
        payload: { name: 'x' },
      });
      expect(res.statusCode).toBe(404);
      expect(res.json<{ error: string }>().error).toBe('ZONE_NOT_FOUND');
    });
  });
});
