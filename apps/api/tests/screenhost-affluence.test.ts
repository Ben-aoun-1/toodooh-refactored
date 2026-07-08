import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import {
  type NewUser,
  screenhostAffluence,
  screenhostMonthlyReports,
  screenhosts,
  users,
} from '../src/db/schema.js';
import { screenhostsRoutes } from '../src/routes/screenhosts.js';
import { storage } from '../src/storage/s3-storage.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// Integration suite — real Postgres. getSession is mocked to drive the owner identity. Affluence is
// the venue audience pattern (weekday × hour); this exercises the first READER of the write-only
// screenhost_affluence table, owner-scoped like the WiFi routes.
type GetSessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;
type AffluenceResponse = { grid: number[][]; has_data: boolean };

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
      email: `aff${seq}@example.com`,
      contactName: `User ${seq}`,
      role: 'individual_owner',
      status: 'approved',
      ...values,
    })
    .returning();
  return u?.id ?? '';
};

const seedScreenhost = async (ownerId: string, name = 'Café Test'): Promise<string> => {
  const [s] = await db.insert(screenhosts).values({ name, ownerId }).returning();
  return s?.id ?? '';
};

const seedAffluence = async (
  screenhostId: string,
  slots: { day: number; hour: number; value: number }[],
): Promise<void> => {
  if (slots.length === 0) return;
  await db.insert(screenhostAffluence).values(
    slots.map((s) => ({
      screenhostId,
      dayOfWeek: s.day,
      hour: s.hour,
      estimatedImpressions: s.value,
    })),
  );
};

// sql is shared across both describes — close it ONCE at the file level.
afterAll(async () => {
  await sql.end();
});

describe('screenhost affluence read (owner-scoped, real Postgres)', () => {
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

  const get = (id: string) =>
    app.inject({ method: 'GET', url: `/api/screenhosts/${id}/affluence` });

  it('returns a 7×24 grid with the owner’s slots placed (Monday-first)', async () => {
    const me = await seedUser();
    const sh = await seedScreenhost(me);
    await seedAffluence(sh, [
      { day: 1, hour: 9, value: 100 }, // Monday 09h
      { day: 3, hour: 18, value: 250 }, // Wednesday 18h
      { day: 7, hour: 23, value: 40 }, // Sunday 23h
    ]);
    mockSession(me);

    const res = await get(sh);
    expect(res.statusCode).toBe(200);
    const body = res.json() as AffluenceResponse;
    expect(body.has_data).toBe(true);
    expect(body.grid).toHaveLength(7);
    expect(body.grid.every((row) => row.length === 24)).toBe(true);
    expect(body.grid[0]?.[9]).toBe(100); // Monday=row 0
    expect(body.grid[2]?.[18]).toBe(250); // Wednesday=row 2
    expect(body.grid[6]?.[23]).toBe(40); // Sunday=row 6
    expect(body.grid[1]?.[0]).toBe(0); // untouched slot
  });

  it('returns an all-zero grid + has_data=false for a venue with no affluence', async () => {
    const me = await seedUser();
    const sh = await seedScreenhost(me);
    mockSession(me);

    const res = await get(sh);
    expect(res.statusCode).toBe(200);
    const body = res.json() as AffluenceResponse;
    expect(body.has_data).toBe(false);
    expect(body.grid).toHaveLength(7);
    expect(body.grid.flat().every((v) => v === 0)).toBe(true);
  });

  it('returns 404 for another owner’s screenhost (owner-scope)', async () => {
    const me = await seedUser();
    const other = await seedUser();
    const foreign = await seedScreenhost(other);
    await seedAffluence(foreign, [{ day: 1, hour: 12, value: 999 }]);
    mockSession(me);

    expect((await get(foreign)).statusCode).toBe(404);
  });

  it('returns 404 for an unowned (ownerless) screenhost', async () => {
    const me = await seedUser();
    const [orphan] = await db.insert(screenhosts).values({ name: 'Orphan' }).returning();
    mockSession(me);
    expect((await get(orphan?.id ?? '')).statusCode).toBe(404);
  });

  it('rejects a non-uuid id (400)', async () => {
    const me = await seedUser();
    mockSession(me);
    expect(
      (await app.inject({ method: 'GET', url: '/api/screenhosts/not-a-uuid/affluence' }))
        .statusCode,
    ).toBe(400);
  });

  it('requires authentication (401)', async () => {
    mockNoSession();
    expect((await get('00000000-0000-0000-0000-000000000000')).statusCode).toBe(401);
  });

  it('forbids a rejected owner (403, requireActiveAccount)', async () => {
    const me = await seedUser({ status: 'rejected' });
    const sh = await seedScreenhost(me);
    mockSession(me, 'individual_owner', 'rejected');
    expect((await get(sh)).statusCode).toBe(403);
  });
});

describe('screenhost monthly-report download (STORED artifact, owner-scoped, real Postgres)', () => {
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
  // R1: the route serves the STORED MinIO artifact — a screenhost_monthly_reports row plus the
  // object behind its storage_key (storage.download is spied; MinIO itself is out of scope here).
  const seedStoredReport = async (screenhostId: string, month: string): Promise<string> => {
    const key = `reports/${screenhostId}/${month}.pdf`;
    await db.insert(screenhostMonthlyReports).values({ screenhostId, month, storageKey: key });
    return key;
  };
  const report = (id: string, month: string) =>
    app.inject({ method: 'GET', url: `/api/screenhosts/${id}/monthly-report?month=${month}` });

  it('streams the STORED artifact for the owner’s own screenhost + month', async () => {
    const me = await seedUser();
    const sh = await seedScreenhost(me);
    const key = await seedStoredReport(sh, '2026-05');
    const download = vi
      .spyOn(storage, 'download')
      .mockResolvedValue({ body: Buffer.from('%PDF-stored'), contentType: 'application/pdf' });
    mockSession(me);

    const res = await report(sh, '2026-05');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.rawPayload.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(download).toHaveBeenCalledWith({ key });
  });

  it('404 REPORT_NOT_GENERATED for a month with no stored artifact', async () => {
    const me = await seedUser();
    const sh = await seedScreenhost(me);
    await seedStoredReport(sh, '2026-05');
    mockSession(me);
    const res = await report(sh, '2026-04'); // no April artifact
    expect(res.statusCode).toBe(404);
    expect(res.json<{ error: string }>().error).toBe('REPORT_NOT_GENERATED');
  });

  it('503 REPORT_STORAGE_UNAVAILABLE when the stored object cannot be fetched', async () => {
    const me = await seedUser();
    const sh = await seedScreenhost(me);
    await seedStoredReport(sh, '2026-05');
    vi.spyOn(storage, 'download').mockResolvedValue({ error: 'connection refused' });
    mockSession(me);
    const res = await report(sh, '2026-05');
    expect(res.statusCode).toBe(503);
    expect(res.json<{ error: string }>().error).toBe('REPORT_STORAGE_UNAVAILABLE');
  });

  it('404 for another owner’s screenhost (owner-scope)', async () => {
    const me = await seedUser();
    const other = await seedUser();
    const foreign = await seedScreenhost(other);
    await seedStoredReport(foreign, '2026-05');
    mockSession(me);
    expect((await report(foreign, '2026-05')).statusCode).toBe(404);
  });

  it('400 on a malformed month', async () => {
    const me = await seedUser();
    const sh = await seedScreenhost(me);
    mockSession(me);
    expect((await report(sh, 'May-2026')).statusCode).toBe(400);
  });
});
