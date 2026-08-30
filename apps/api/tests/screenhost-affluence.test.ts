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
type AffluenceSource = 'measured' | 'backup' | null;
type AffluenceResponse = {
  grid: number[][];
  has_data: boolean;
  sources: AffluenceSource[][];
  counts: { measured: number; backup: number };
};

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
  slots: { day: number; hour: number; value: number; source?: AffluenceSource }[],
): Promise<void> => {
  if (slots.length === 0) return;
  await db.insert(screenhostAffluence).values(
    slots.map((s) => ({
      screenhostId,
      dayOfWeek: s.day,
      hour: s.hour,
      estimatedImpressions: s.value,
      source: s.source ?? null,
    })),
  );
};

// sql is shared across both describes — close it ONCE at the file level.
afterAll(async () => {
  await sql.end();
});

// PERF-R2 (operator 2026-08-30) — the période scopes the heatmap read: ?from&to masks the
// weekdays the période does not contain (a 7+-day période keeps the whole week). The merged
// PAX-first values and their provenance are untouched — only weekday membership is scoped.
describe('screenhost affluence read — ?from&to période mask (PERF-R2)', () => {
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

  const getRange = (id: string, qs: string) =>
    app.inject({ method: 'GET', url: `/api/screenhosts/${id}/affluence${qs}` });

  it('masks the weekdays outside the période; kept cells keep value AND provenance', async () => {
    const me = await seedUser();
    const sh = await seedScreenhost(me);
    await seedAffluence(sh, [
      { day: 1, hour: 9, value: 100, source: 'measured' }, // Monday — inside the période
      { day: 3, hour: 18, value: 250, source: 'backup' }, // Wednesday — outside
    ]);
    mockSession(me);

    // 2026-08-03 (Mon) .. 2026-08-04 (Tue)
    const res = await getRange(sh, '?from=2026-08-03&to=2026-08-04');
    expect(res.statusCode).toBe(200);
    const body = res.json() as AffluenceResponse;
    expect(body.grid[0]?.[9]).toBe(100); // Monday kept (PAX cell wins stays visible)
    expect(body.sources[0]?.[9]).toBe('measured');
    expect(body.grid[2]?.[18]).toBe(0); // Wednesday masked
    expect(body.sources[2]?.[18]).toBeNull();
    expect(body.counts).toEqual({ measured: 1, backup: 0 });
    expect(body.has_data).toBe(true);
  });

  it('a période containing none of the data weekdays serves the empty state', async () => {
    const me = await seedUser();
    const sh = await seedScreenhost(me);
    await seedAffluence(sh, [{ day: 3, hour: 18, value: 250, source: 'backup' }]);
    mockSession(me);

    // Sat 2026-08-01 .. Sun 2026-08-02 — Wednesday is not in the période.
    const body = (await getRange(sh, '?from=2026-08-01&to=2026-08-02')).json() as AffluenceResponse;
    expect(body.has_data).toBe(false);
    expect(body.grid.flat().every((v) => v === 0)).toBe(true);
    expect(body.counts).toEqual({ measured: 0, backup: 0 });
  });

  it('a 7+-day période keeps every weekday, and no params keeps the unscoped read', async () => {
    const me = await seedUser();
    const sh = await seedScreenhost(me);
    await seedAffluence(sh, [
      { day: 1, hour: 9, value: 100, source: 'measured' },
      { day: 7, hour: 12, value: 60, source: 'backup' },
    ]);
    mockSession(me);

    const week = (await getRange(sh, '?from=2026-08-01&to=2026-08-31')).json() as AffluenceResponse;
    expect(week.grid[0]?.[9]).toBe(100);
    expect(week.grid[6]?.[12]).toBe(60);
    expect(week.counts).toEqual({ measured: 1, backup: 1 });

    const bare = (await getRange(sh, '')).json() as AffluenceResponse;
    expect(bare.counts).toEqual({ measured: 1, backup: 1 });
  });

  it('rejects a malformed or one-sided from/to (400)', async () => {
    const me = await seedUser();
    const sh = await seedScreenhost(me);
    mockSession(me);
    expect((await getRange(sh, '?from=03/08/2026&to=2026-08-04')).statusCode).toBe(400);
    expect((await getRange(sh, '?from=2026-08-03')).statusCode).toBe(400);
  });
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

  // AFF1 — provenance rides beside the grid: sources[day][hour] mirrors grid's Monday-first shape,
  // counts are PURE provenance tallies (a measured 0 is still a measurement; a NULL-source row —
  // pushed by a pre-AFF1 hub — is neither).
  it('AFF1: returns sources (7×24, Monday-first) + counts, a measured 0 counting as measured', async () => {
    const me = await seedUser();
    const sh = await seedScreenhost(me);
    await seedAffluence(sh, [
      { day: 1, hour: 9, value: 100, source: 'measured' },
      { day: 1, hour: 10, value: 0, source: 'measured' }, // measured zero
      { day: 3, hour: 18, value: 250, source: 'backup' },
      { day: 5, hour: 8, value: 12 }, // pre-AFF1 row: unknown provenance
    ]);
    mockSession(me);

    const res = await get(sh);
    expect(res.statusCode).toBe(200);
    const body = res.json() as AffluenceResponse;
    expect(body.sources).toHaveLength(7);
    expect(body.sources.every((row) => row.length === 24)).toBe(true);
    expect(body.sources[0]?.[9]).toBe('measured');
    expect(body.sources[0]?.[10]).toBe('measured');
    expect(body.sources[2]?.[18]).toBe('backup');
    expect(body.sources[4]?.[8]).toBeNull(); // value present, provenance unknown
    expect(body.sources[1]?.[0]).toBeNull(); // no row at all
    expect(body.grid[4]?.[8]).toBe(12); // the value itself is unaffected by unknown provenance
    expect(body.counts).toEqual({ measured: 2, backup: 1 });
  });

  it('AFF1: an empty venue returns all-null sources + zero counts', async () => {
    const me = await seedUser();
    const sh = await seedScreenhost(me);
    mockSession(me);

    const body = (await get(sh)).json() as AffluenceResponse;
    expect(body.sources).toHaveLength(7);
    expect(body.sources.flat().every((v) => v === null)).toBe(true);
    expect(body.counts).toEqual({ measured: 0, backup: 0 });
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
