import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import {
  type NewUser,
  screenhostAffluence,
  screenhostAffluenceHourly,
  screenhostMonthlyReports,
  screenhosts,
  users,
} from '../src/db/schema.js';
import { screenhostsRoutes } from '../src/routes/screenhosts.js';
import { storage } from '../src/storage/s3-storage.js';

import { resetAuthTables, bothHalves } from './helpers/db-test-setup.js';

// Integration suite — real Postgres. getSession is mocked to drive the owner identity. Affluence is
// the venue audience pattern (weekday × hour); this exercises the first READER of the write-only
// screenhost_affluence table, owner-scoped like the WiFi routes.
type GetSessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;
type AffluenceSource = 'measured' | 'backup' | null;
type AffluenceResponse = {
  grid: (number | null)[][];
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

const seedScreenhost = async (
  ownerId: string,
  name = 'Café Test',
  values: Partial<typeof screenhosts.$inferInsert> = {},
): Promise<string> => {
  const [s] = await db
    .insert(screenhosts)
    .values({ name, ownerId, ...values })
    .returning();
  return s?.id ?? '';
};

/** MEJ-R1 — the backup grid answers only from the venue's onboarding day; every ranged fixture
 *  below is onboarded well before the périodes under test. */
const ONBOARDED_EARLY = { createdAt: new Date('2026-07-01T00:00:00Z') };

const seedHourly = async (
  screenhostId: string,
  cells: { date: string; hour: number; value: number }[],
): Promise<void> => {
  if (cells.length === 0) return;
  await db
    .insert(screenhostAffluenceHourly)
    .values(bothHalves(cells.map((c) => ({ screenhostId, ...c }))));
};

const seedAffluence = async (
  screenhostId: string,
  slots: { day: number; hour: number; value: number; source?: AffluenceSource }[],
): Promise<void> => {
  if (slots.length === 0) return;
  await db.insert(screenhostAffluence).values(
    bothHalves(
      slots.map((s) => ({
        screenhostId,
        dayOfWeek: s.day,
        hour: s.hour,
        estimatedImpressions: s.value,
        source: s.source ?? null,
      })),
    ),
  );
};

// sql is shared across both describes — close it ONCE at the file level.
afterAll(async () => {
  await sql.end();
});

// AUD-HOURLY1-C — ?from&to no longer MASKS the hub's rolling typical week (PERF-R2's approach):
// it aggregates the PÉRIODE'S OWN (date, hour) cells into weekday × hour, through the same merge
// S01 runs. Two consequences these tests pin:
//   • the MEJ-2 onboarding floor applies — the backup grid cannot answer for days before the
//     venue existed, so every fixture states its onboarding date;
//   • provenance is DERIVED, not read back. A slot the merge filled from the admin's grid is
//     'backup' even where the hub had marked its rolling-grid slot 'measured', because in the
//     période view the real measurement comes from screenhost_affluence_hourly. The BARE read
//     (« Votre audience ») still serves the hub's stored provenance, untouched.
describe('screenhost affluence read — ?from&to période aggregation (AUD-HOURLY1-C)', () => {
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

  it('serves only the weekdays the période contains, from the merge', async () => {
    const me = await seedUser();
    const sh = await seedScreenhost(me, 'Café Test', ONBOARDED_EARLY);
    await seedAffluence(sh, [
      { day: 1, hour: 9, value: 100, source: 'measured' }, // Monday — inside the période
      { day: 3, hour: 18, value: 250, source: 'backup' }, // Wednesday — outside
    ]);
    mockSession(me);

    // 2026-08-03 (Mon) .. 2026-08-04 (Tue)
    const res = await getRange(sh, '?from=2026-08-03&to=2026-08-04');
    expect(res.statusCode).toBe(200);
    const body = res.json() as AffluenceResponse;
    expect(body.grid[0]?.[18]).toBe(100); // Monday: the grid stood in for an unmeasured hour
    // …and it says so: no hourly cell exists, so this value is an ESTIMATION whatever the hub
    // had marked on its own rolling slot.
    expect(body.sources[0]?.[18]).toBe('backup');
    expect(body.grid[2]?.[36]).toBeNull(); // Wednesday is not in the période — no cell at all
    expect(body.sources[2]?.[36]).toBeNull();
    expect(body.counts).toEqual({ measured: 0, backup: 2 }); // slice C — tallies count SLOTS, so an hour-shaped fixture counts twice
    expect(body.has_data).toBe(true);
  });

  it('a MEASURED hourly cell shows through as measured, and wins over the grid', async () => {
    const me = await seedUser();
    const sh = await seedScreenhost(me, 'Café Test', ONBOARDED_EARLY);
    await seedAffluence(sh, [{ day: 1, hour: 9, value: 100, source: 'backup' }]);
    await seedHourly(sh, [{ date: '2026-08-03', hour: 9, value: 12 }]); // a Monday
    mockSession(me);

    const body = (await getRange(sh, '?from=2026-08-03&to=2026-08-03')).json() as AffluenceResponse;
    expect(body.grid[0]?.[18]).toBe(12); // the measure, not the grid's 100
    expect(body.sources[0]?.[18]).toBe('measured');
    expect(body.counts).toEqual({ measured: 2, backup: 0 }); // slice C — tallies count SLOTS, so an hour-shaped fixture counts twice
  });

  it("Mejri's outage, end to end: a measured ZERO hour renders the grid value as backup", async () => {
    const me = await seedUser();
    const sh = await seedScreenhost(me, 'Café Test', ONBOARDED_EARLY);
    await seedAffluence(sh, [
      { day: 1, hour: 9, value: 25, source: 'backup' },
      { day: 1, hour: 10, value: 30, source: 'backup' },
    ]);
    await seedHourly(sh, [
      { date: '2026-08-03', hour: 9, value: 12 },
      { date: '2026-08-03', hour: 10, value: 0 }, // the sensor was unplugged
    ]);
    mockSession(me);

    const body = (await getRange(sh, '?from=2026-08-03&to=2026-08-03')).json() as AffluenceResponse;
    expect(body.grid[0]?.[18]).toBe(12);
    expect(body.sources[0]?.[18]).toBe('measured');
    expect(body.grid[0]?.[20]).toBe(30); // FORCED from the admin's grid, not left at 0
    expect(body.sources[0]?.[20]).toBe('backup');
  });

  it('a période containing none of the data weekdays serves the empty state', async () => {
    const me = await seedUser();
    const sh = await seedScreenhost(me, 'Café Test', ONBOARDED_EARLY);
    await seedAffluence(sh, [{ day: 3, hour: 18, value: 250, source: 'backup' }]);
    mockSession(me);

    // Sat 2026-08-01 .. Sun 2026-08-02 — Wednesday is not in the période.
    const body = (await getRange(sh, '?from=2026-08-01&to=2026-08-02')).json() as AffluenceResponse;
    expect(body.has_data).toBe(false);
    expect(body.grid.flat().every((v) => v === null)).toBe(true); // HOUR-AVG2 — no cell = null
    expect(body.counts).toEqual({ measured: 0, backup: 0 });
  });

  it('a 7+-day période reaches every weekday; the BARE read keeps the stored provenance', async () => {
    const me = await seedUser();
    const sh = await seedScreenhost(me, 'Café Test', ONBOARDED_EARLY);
    await seedAffluence(sh, [
      { day: 1, hour: 9, value: 100, source: 'measured' },
      { day: 7, hour: 12, value: 60, source: 'backup' },
    ]);
    mockSession(me);

    const week = (await getRange(sh, '?from=2026-08-01&to=2026-08-31')).json() as AffluenceResponse;
    expect(week.grid[0]?.[18]).toBe(100);
    expect(week.grid[6]?.[24]).toBe(60);
    // Both derived from the grid → both estimations in the période view.
    expect(week.counts).toEqual({ measured: 0, backup: 4 }); // slice C — tallies count SLOTS, so an hour-shaped fixture counts twice

    // « Votre audience » (no params) is untouched by this lane: the hub's own provenance stands.
    const bare = (await getRange(sh, '')).json() as AffluenceResponse;
    expect(bare.counts).toEqual({ measured: 2, backup: 2 }); // slice C — tallies count SLOTS, so an hour-shaped fixture counts twice
    expect(bare.sources[0]?.[18]).toBe('measured');
  });

  it('rejects a malformed or one-sided from/to (400)', async () => {
    const me = await seedUser();
    const sh = await seedScreenhost(me);
    mockSession(me);
    expect((await getRange(sh, '?from=03/08/2026&to=2026-08-04')).statusCode).toBe(400);
    expect((await getRange(sh, '?from=2026-08-03')).statusCode).toBe(400);
    // AUD-HOURLY1-C rider — well-shaped but impossible; it now reaches a Postgres DATE range.
    expect((await getRange(sh, '?from=2026-02-30&to=2026-03-01')).statusCode).toBe(400);
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

  it('returns a 7×48 grid with the owner’s slots placed (Monday-first)', async () => {
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
    expect(body.grid.every((row) => row.length === 48)).toBe(true); // slice C — SLOT columns
    expect(body.grid[0]?.[18]).toBe(100); // Monday=row 0
    expect(body.grid[2]?.[36]).toBe(250); // Wednesday=row 2
    expect(body.grid[6]?.[46]).toBe(40); // Sunday=row 6
    expect(body.grid[1]?.[0]).toBeNull(); // untouched slot — HOUR-AVG2: no row is null, never 0
  });

  it('returns an all-null grid + has_data=false for a venue with no affluence', async () => {
    const me = await seedUser();
    const sh = await seedScreenhost(me);
    mockSession(me);

    const res = await get(sh);
    expect(res.statusCode).toBe(200);
    const body = res.json() as AffluenceResponse;
    expect(body.has_data).toBe(false);
    expect(body.grid).toHaveLength(7);
    expect(body.grid.flat().every((v) => v === null)).toBe(true);
  });

  // HOUR-AVG2 (operator 17/09) — the client folds an hour as the mean of the halves it HAS, so the
  // wire must tell « no reading » (null) from « measured 0 » (0). 59 lone halves exist on prod.
  it('HOUR-AVG2: a lone half-hour row is served as itself, its missing sibling as null; a measured 0 stays 0', async () => {
    const me = await seedUser();
    const sh = await seedScreenhost(me);
    await db.insert(screenhostAffluence).values([
      // Sunday 01h00 alone (its 01h30 was never pushed).
      {
        screenhostId: sh,
        dayOfWeek: 7,
        hour: 1,
        slot: 2,
        estimatedImpressions: 10,
        source: 'measured',
      },
      // Monday 09h: 17 and a MEASURED 0.
      {
        screenhostId: sh,
        dayOfWeek: 1,
        hour: 9,
        slot: 18,
        estimatedImpressions: 17,
        source: 'measured',
      },
      {
        screenhostId: sh,
        dayOfWeek: 1,
        hour: 9,
        slot: 19,
        estimatedImpressions: 0,
        source: 'measured',
      },
    ]);
    mockSession(me);

    const body = (await get(sh)).json() as AffluenceResponse;
    expect(body.grid[6]?.[2]).toBe(10);
    expect(body.grid[6]?.[3]).toBeNull();
    expect(body.sources[6]?.[3]).toBeNull();
    expect(body.grid[0]?.[18]).toBe(17);
    expect(body.grid[0]?.[19]).toBe(0);
    expect(body.sources[0]?.[19]).toBe('measured');
    expect(body.grid.flat().filter((v) => v !== null)).toHaveLength(3);
    expect(body.has_data).toBe(true);
  });

  // AFF1 — provenance rides beside the grid: sources[day][hour] mirrors grid's Monday-first shape,
  // counts are PURE provenance tallies (a measured 0 is still a measurement; a NULL-source row —
  // pushed by a pre-AFF1 hub — is neither).
  it('AFF1: returns sources (7×48, Monday-first) + counts, a measured 0 counting as measured', async () => {
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
    expect(body.sources.every((row) => row.length === 48)).toBe(true); // slice C
    expect(body.sources[0]?.[18]).toBe('measured');
    expect(body.sources[0]?.[20]).toBe('measured');
    expect(body.sources[2]?.[36]).toBe('backup');
    expect(body.sources[4]?.[16]).toBeNull(); // value present, provenance unknown
    expect(body.sources[1]?.[0]).toBeNull(); // no row at all
    expect(body.grid[4]?.[16]).toBe(12); // the value itself is unaffected by unknown provenance
    expect(body.counts).toEqual({ measured: 4, backup: 2 }); // slice C — tallies count SLOTS, so an hour-shaped fixture counts twice
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
