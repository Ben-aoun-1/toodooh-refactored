import { eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import { type NewUser, predefinedZones, users } from '../src/db/schema.js';
import { apiRoutes } from '../src/routes/index.js';
import { storage } from '../src/storage/s3-storage.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// Dependency-free multipart body (form-data not installed; web FormData isn't inject-consumable).
// Mirrors profile-documents.test.ts. Single `file` part; the zone :id rides in the URL path.
const multipartBody = (file: { filename: string; contentType: string; content: Buffer }) => {
  const boundary = `----toodoohzone${Date.now()}${Math.random().toString(16).slice(2)}`;
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
    it('200, serves the GRAND TUNIS seed (0012 collapse), lat/lng as NUMBER + snake_case keys', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/predefined-zones' });
      expect(res.statusCode).toBe(200);
      const rows = res.json<ZoneRow[]>();
      // Post-0012 seed: the 8 city zones collapsed into the single GRAND TUNIS row
      // (>= 1 tolerates any rows other suites might leave; afterEach cleans ours).
      expect(rows.length).toBeGreaterThanOrEqual(1);
      expect(rows.find((r) => r.name === 'Ariana')).toBeUndefined();

      const grandTunis = rows.find((r) => r.name === 'GRAND TUNIS');
      expect(grandTunis).toBeDefined();
      // LOAD-BEARING: the serializer Number()s the numeric columns. Without it Drizzle yields strings
      // and the wizard's Haversine + Leaflet-circle math breaks.
      expect(typeof grandTunis?.latitude).toBe('number');
      expect(typeof grandTunis?.longitude).toBe('number');
      expect(grandTunis?.latitude).toBeCloseTo(36.842, 4);
      expect(grandTunis?.longitude).toBeCloseTo(10.253, 4);
      expect(typeof grandTunis?.radius).toBe('number');
      expect(grandTunis?.radius).toBe(13000);
      // snake_case keys the PredefinedZone interface expects.
      expect(grandTunis).toHaveProperty('is_active');
      expect(grandTunis).toHaveProperty('image_url');
      expect(grandTunis).toHaveProperty('created_at');
      // C3 serializer: seeded zones have a null image_url → stays null (consumer's picsum fallback).
      expect(grandTunis?.image_url).toBeNull();
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

  describe('POST /:id/image (multipart, real MinIO)', () => {
    const png = Buffer.from('\x89PNG\r\n\x1a\n fake zone image bytes');

    // Create a real zone, return its id. Named TEST_ZONE_NAME so the outer afterEach reaps the row.
    const seedZone = async (): Promise<string> => {
      const [z] = await db
        .insert(predefinedZones)
        .values({ name: TEST_ZONE_NAME, latitude: '36.5', longitude: '10.25', radius: 2500 })
        .returning({ id: predefinedZones.id });
      return z?.id ?? '';
    };

    it('uploads → 200 {id,key}, persists image_url=zones/<id>, stable key', async () => {
      mockSession(adminId, 'superadmin');
      const id = await seedZone();
      const res = await app.inject({
        method: 'POST',
        url: `/api/predefined-zones/${id}/image`,
        ...multipartBody({ filename: 'z.png', contentType: 'image/png', content: png }),
      });
      try {
        expect(res.statusCode).toBe(200);
        expect(res.json<{ id: string; key: string }>()).toEqual({ id, key: `zones/${id}` });

        // Column persisted server-side (route owns image_url — §3).
        const [row] = await db
          .select({ imageUrl: predefinedZones.imageUrl })
          .from(predefinedZones)
          .where(eq(predefinedZones.id, id))
          .limit(1);
        expect(row?.imageUrl).toBe(`zones/${id}`);

        // C3 serializer: the bare key is composed to /storage/<key> on read (what the consumer renders).
        const list = await app.inject({ method: 'GET', url: '/api/predefined-zones' });
        const served = list.json<ZoneRow[]>().find((z) => z.id === id);
        expect(served?.image_url).toBe(`/storage/zones/${id}`);
      } finally {
        await storage.delete({ key: `zones/${id}` }).catch(() => undefined);
      }
    });

    it('unknown :id → 404 ZONE_NOT_FOUND (before touching storage)', async () => {
      mockSession(adminId, 'superadmin');
      const res = await app.inject({
        method: 'POST',
        url: '/api/predefined-zones/00000000-0000-0000-0000-000000000000/image',
        ...multipartBody({ filename: 'z.png', contentType: 'image/png', content: png }),
      });
      expect(res.statusCode).toBe(404);
      expect(res.json<{ error: string }>().error).toBe('ZONE_NOT_FOUND');
    });

    it('non-image MIME (pdf) → 400', async () => {
      mockSession(adminId, 'superadmin');
      const id = await seedZone();
      try {
        const res = await app.inject({
          method: 'POST',
          url: `/api/predefined-zones/${id}/image`,
          ...multipartBody({
            filename: 'z.pdf',
            contentType: 'application/pdf',
            content: Buffer.from('%PDF-1.4'),
          }),
        });
        expect(res.statusCode).toBe(400);
      } finally {
        await storage.delete({ key: `zones/${id}` }).catch(() => undefined);
      }
    });

    it('non-admin → 403', async () => {
      mockSession(adminId, 'advertiser');
      const res = await app.inject({
        method: 'POST',
        url: '/api/predefined-zones/00000000-0000-0000-0000-000000000000/image',
        ...multipartBody({ filename: 'z.png', contentType: 'image/png', content: png }),
      });
      expect(res.statusCode).toBe(403);
    });
  });
});
