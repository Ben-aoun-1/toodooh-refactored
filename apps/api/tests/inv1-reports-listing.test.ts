import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import {
  type NewUser,
  screenhostAffluence,
  screenhostMonthlyReports,
  screenhostMonthlyStats,
  screenhosts,
  users,
} from '../src/db/schema.js';
import { runMonthlyReportSweep } from '../src/lib/report/monthly-job.js';
import { screenhostsRoutes } from '../src/routes/screenhosts.js';
import { storage } from '../src/storage/s3-storage.js';

import { resetAuthTables, bothHalves } from './helpers/db-test-setup.js';

// HOTFIX INV-1 — the prod regression pin: at ~23:55 on 2026-08-07 the reports LISTING returned
// empty for a venue whose stored July report still served through the by-month route. The pin
// reproduces prod's exact shape — a June row generated late July (old single-month sweep), a July
// row generated 01/08, hub-pushed stats for both months — then runs FULL catch-up sweep ticks
// over those existing months (the amended R2 path's first prod executions were the only thing
// that ran between the good and broken observations) and asserts the listing still returns ALL
// rows, stably ordered, and the by-month download still serves.
const renderSpy = vi.hoisted(() => vi.fn(async () => Buffer.from('%PDF-inv1-fake')));
vi.mock('../src/lib/report/render.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/report/render.js')>();
  return { ...actual, renderPdf: renderSpy, resolveChromiumPath: () => '/usr/bin/fake-chromium' };
});

// Both AI-pistes seams mocked at the module boundary: the sweep's uncached generator and the
// routes' cached one (no key/SDK in this suite).
const pistesSpy = vi.hoisted(() => vi.fn());
const pistesCachedSpy = vi.hoisted(() => vi.fn());
vi.mock('../src/lib/report/recommendations.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/report/recommendations.js')>();
  return { ...actual, pistesForReport: pistesSpy, pistesForReportCached: pistesCachedSpy };
});

type GetSessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;

const buildApp = () => Fastify({ logger: false });

const mockSession = (userId: string): void => {
  vi.spyOn(auth.api, 'getSession').mockResolvedValue({
    session: {},
    user: { id: userId, role: 'individual_owner', status: 'approved' },
  } as unknown as GetSessionResult);
};

const silentLog = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
  fatal: () => undefined,
  trace: () => undefined,
  child: () => silentLog,
  level: 'silent',
} as unknown as Parameters<typeof runMonthlyReportSweep>[0];

let seq = 0;
const seedUser = async (values: Partial<NewUser> = {}): Promise<string> => {
  seq += 1;
  const [u] = await db
    .insert(users)
    .values({
      email: `inv1-${seq}@example.com`,
      contactName: `User ${seq}`,
      role: 'individual_owner',
      status: 'approved',
      ...values,
    })
    .returning();
  return u?.id ?? '';
};

// 2026-08-07 late evening in Tunis — the catch-up window is [2026-07, 2026-06, 2026-05].
const NOW = new Date('2026-08-07T21:30:00Z');

const JUNE_GENERATED = new Date('2026-07-26T09:00:00Z'); // old single-month sweep, late July
const JULY_GENERATED = new Date('2026-08-01T06:30:00Z'); // month-close generation

afterAll(async () => {
  await sql.end();
});

describe('INV-1 — listing survives catch-up sweep ticks over existing months (real Postgres)', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    await resetAuthTables();
    renderSpy.mockClear();
    pistesSpy.mockReset();
    pistesSpy.mockResolvedValue(null);
    pistesCachedSpy.mockReset();
    pistesCachedSpy.mockResolvedValue(null);
    app = buildApp();
    await app.register(screenhostsRoutes);
    await app.ready();
  });
  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  it('lists ALL stored rows, stably ordered, after repeated full sweep passes; by-month still serves', async () => {
    const owner = await seedUser();
    const [venueRow] = await db
      .insert(screenhosts)
      .values({ name: 'fffrfr', ownerId: owner })
      .returning();
    const venue = venueRow?.id ?? '';
    // Prod's data shape: lifetime affluence (candidate signal) + hub-pushed stats for June/July.
    await db
      .insert(screenhostAffluence)
      .values(
        bothHalves({ screenhostId: venue, dayOfWeek: 1, hour: 12, estimatedImpressions: 40 }),
      );
    for (const month of ['2026-06', '2026-07']) {
      await db.insert(screenhostMonthlyStats).values({
        screenhostId: venue,
        month,
        totalAudience: 900,
        daily: [{ date: `${month}-15`, audience: 900 }],
        peakDayOfWeek: 5,
        peakHour: 18,
      });
    }
    // The stored rows as prod held them at 21:15 — mixed generated_at shapes.
    await db.insert(screenhostMonthlyReports).values([
      {
        screenhostId: venue,
        month: '2026-06',
        storageKey: `reports/${venue}/2026-06.pdf`,
        generatedAt: JUNE_GENERATED,
      },
      {
        screenhostId: venue,
        month: '2026-07',
        storageKey: `reports/${venue}/2026-07.pdf`,
        generatedAt: JULY_GENERATED,
      },
    ]);
    vi.spyOn(storage, 'upload').mockImplementation(async (params) => ({ key: params.key }));
    vi.spyOn(storage, 'download').mockResolvedValue({
      body: Buffer.from('%PDF-stored'),
      contentType: 'application/pdf',
    });

    // The trigger sequence: the amended catch-up path executes over the existing months —
    // several ticks, exactly like the prod evening (idempotent: July/June skip as existing,
    // May skips on the month-scoped gate).
    for (let tick = 0; tick < 2; tick += 1) {
      const result = await runMonthlyReportSweep(silentLog, NOW);
      expect(result.months).toEqual(['2026-07', '2026-06', '2026-05']);
      expect(result.generated).toBe(0);
      expect(result.failed).toBe(0);
    }

    mockSession(owner);
    const listing = await app.inject({ method: 'GET', url: `/api/screenhosts/${venue}/reports` });
    expect(listing.statusCode).toBe(200);
    expect(listing.json<{ reports: { month: string; generated_at: string }[] }>()).toEqual({
      reports: [
        { month: '2026-07', generated_at: '2026-08-01T06:30:00.000Z' },
        { month: '2026-06', generated_at: '2026-07-26T09:00:00.000Z' },
      ],
    });

    const download = await app.inject({
      method: 'GET',
      url: `/api/screenhosts/${venue}/monthly-report?month=2026-07`,
    });
    expect(download.statusCode).toBe(200);
    expect(download.headers['content-type']).toBe('application/pdf');
  });

  // INV-1 redirected charter pin — the empty surfaces must come from DATA, never from a swallowed
  // failure: when the data query dies AFTER ownership resolves (the incident's exact silhouette),
  // the route ERRORS (Fastify 500) instead of answering 200-empty. One venue seeded WITH rows so
  // a swallowed failure would be indistinguishable from « no reports yet ».
  const failSecondSelect = (): void => {
    type DbSelect = typeof db.select;
    const realSelect = db.select.bind(db) as DbSelect;
    let calls = 0;
    vi.spyOn(db, 'select').mockImplementation(((...args: Parameters<DbSelect>) => {
      calls += 1;
      if (calls === 2) throw new Error('inv1: data query lost its connection');
      return realSelect(...args);
    }) as DbSelect);
  };

  it('the reports LISTING surfaces a data-query failure as an error — never 200-empty', async () => {
    const owner = await seedUser();
    const [venueRow] = await db
      .insert(screenhosts)
      .values({ name: 'fffrfr', ownerId: owner })
      .returning();
    const venue = venueRow?.id ?? '';
    await db.insert(screenhostMonthlyReports).values({
      screenhostId: venue,
      month: '2026-07',
      storageKey: `reports/${venue}/2026-07.pdf`,
    });
    mockSession(owner);
    failSecondSelect();

    const res = await app.inject({ method: 'GET', url: `/api/screenhosts/${venue}/reports` });
    expect(res.statusCode).toBe(500);
    expect(res.json<{ reports?: unknown }>().reports).toBeUndefined();
  });

  it('the monthly-stats read surfaces a data-query failure as an error — never 200-empty', async () => {
    const owner = await seedUser();
    const [venueRow] = await db
      .insert(screenhosts)
      .values({ name: 'fffrfr', ownerId: owner })
      .returning();
    const venue = venueRow?.id ?? '';
    await db.insert(screenhostMonthlyStats).values({
      screenhostId: venue,
      month: '2026-07',
      totalAudience: 900,
      daily: [{ date: '2026-07-15', audience: 900 }],
      peakDayOfWeek: 5,
      peakHour: 18,
    });
    mockSession(owner);
    failSecondSelect();

    const res = await app.inject({
      method: 'GET',
      url: `/api/screenhosts/${venue}/monthly-stats`,
    });
    expect(res.statusCode).toBe(500);
    expect(res.json<{ months?: unknown }>().months).toBeUndefined();
  });
});
