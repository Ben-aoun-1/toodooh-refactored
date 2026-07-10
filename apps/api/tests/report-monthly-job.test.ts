import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { db, sql } from '../src/db/client.js';
import {
  type NewUser,
  notifications,
  screenhostAffluence,
  screenhostMonthlyReports,
  screenhosts,
  users,
} from '../src/db/schema.js';
import { previousClosedMonth, runMonthlyReportSweep } from '../src/lib/report/monthly-job.js';
import { storage } from '../src/storage/s3-storage.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// The month-end job (R1) — chromium is mocked at the render seam; storage.upload is spied. The
// UNIQUE(screenhost, month) idempotency + notification-once semantics run against real Postgres.
const renderSpy = vi.hoisted(() =>
  vi.fn(async (html: string) => {
    void html;
    return Buffer.from('%PDF-job-fake');
  }),
);
vi.mock('../src/lib/report/render.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/report/render.js')>();
  return {
    ...actual,
    renderPdf: renderSpy,
    resolveChromiumPath: () => '/usr/bin/fake-chromium',
  };
});

// R2 — the AI pistes seam, mocked at the module boundary (no key/SDK in this suite). Default:
// null → the generic pistes, exactly like an unprovisioned box.
const pistesSpy = vi.hoisted(() => vi.fn());
vi.mock('../src/lib/report/recommendations.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/report/recommendations.js')>();
  return { ...actual, pistesForReport: pistesSpy };
});

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
      email: `job${seq}@example.com`,
      contactName: `User ${seq}`,
      role: 'individual_owner',
      status: 'approved',
      ...values,
    })
    .returning();
  return u?.id ?? '';
};

const seedVenueWithData = async (ownerId: string, name: string): Promise<string> => {
  const [s] = await db.insert(screenhosts).values({ name, ownerId }).returning();
  const id = s?.id ?? '';
  // Any data qualifies a venue — one affluence slot is the cheapest HOST signal.
  await db
    .insert(screenhostAffluence)
    .values({ screenhostId: id, dayOfWeek: 1, hour: 12, estimatedImpressions: 40 });
  return id;
};

// 2026-07-08 UTC noon — Tunis July 8th; the previous closed month is June 2026.
const NOW = new Date('2026-07-08T12:00:00Z');

afterAll(async () => {
  await sql.end();
});

describe('previousClosedMonth (Africa/Tunis month close)', () => {
  it('mid-month → the previous calendar month with its exact bounds', () => {
    expect(previousClosedMonth(new Date('2026-07-08T12:00:00Z'))).toEqual({
      month: '2026-06',
      from: '2026-06-01',
      to: '2026-06-30',
    });
  });

  it('January rolls back to the previous year December (year boundary)', () => {
    expect(previousClosedMonth(new Date('2026-01-15T12:00:00Z'))).toEqual({
      month: '2025-12',
      from: '2025-12-01',
      to: '2025-12-31',
    });
  });

  it("the month closes at TUNIS local midnight, not UTC's", () => {
    // 2026-06-30T23:30Z = 2026-07-01T00:30 Tunis (UTC+1): June is ALREADY closed in Tunis.
    expect(previousClosedMonth(new Date('2026-06-30T23:30:00Z')).month).toBe('2026-06');
    // One hour earlier it is still June 30 in Tunis → the closed month is May.
    expect(previousClosedMonth(new Date('2026-06-30T22:30:00Z')).month).toBe('2026-05');
  });

  it('handles February in a leap year', () => {
    expect(previousClosedMonth(new Date('2028-03-05T12:00:00Z'))).toEqual({
      month: '2028-02',
      from: '2028-02-01',
      to: '2028-02-29',
    });
  });
});

describe('runMonthlyReportSweep (real Postgres, mocked render/storage)', () => {
  beforeEach(async () => {
    await resetAuthTables();
    renderSpy.mockClear();
    pistesSpy.mockReset();
    pistesSpy.mockResolvedValue(null);
    vi.restoreAllMocks();
  });

  it('generates + stores + notifies ONCE for a venue with data; the second tick is a no-op', async () => {
    const owner = await seedUser();
    const venue = await seedVenueWithData(owner, 'Café Mensuel');
    const upload = vi
      .spyOn(storage, 'upload')
      .mockResolvedValue({ key: `reports/${venue}/2026-06.pdf` });

    const first = await runMonthlyReportSweep(silentLog, NOW);
    expect(first).toEqual({ month: '2026-06', generated: 1, skipped: 0, failed: 0 });
    expect(upload).toHaveBeenCalledWith(
      expect.objectContaining({
        key: `reports/${venue}/2026-06.pdf`,
        contentType: 'application/pdf',
      }),
    );

    const rows = await db
      .select()
      .from(screenhostMonthlyReports)
      .where(eq(screenhostMonthlyReports.screenhostId, venue));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.month).toBe('2026-06');
    expect(rows[0]?.storageKey).toBe(`reports/${venue}/2026-06.pdf`);

    const notifs = await db.select().from(notifications).where(eq(notifications.userId, owner));
    expect(notifs).toHaveLength(1);
    expect(notifs[0]?.type).toBe('monthly_report_ready');
    expect(notifs[0]?.body).toContain('juin 2026');
    expect(notifs[0]?.body).toContain('Café Mensuel');

    // Second tick: idempotent — no new render, no new row, no second notification.
    const second = await runMonthlyReportSweep(silentLog, NOW);
    expect(second).toEqual({ month: '2026-06', generated: 0, skipped: 1, failed: 0 });
    expect(
      await db
        .select()
        .from(screenhostMonthlyReports)
        .where(eq(screenhostMonthlyReports.screenhostId, venue)),
    ).toHaveLength(1);
    expect(
      await db.select().from(notifications).where(eq(notifications.userId, owner)),
    ).toHaveLength(1);
  });

  it('calls the AI pistes generator ONCE per generated report and freezes its output (R2)', async () => {
    const owner = await seedUser();
    await seedVenueWithData(owner, 'Café IA');
    vi.spyOn(storage, 'upload').mockImplementation(async (params) => ({ key: params.key }));
    pistesSpy.mockResolvedValue([
      { title: 'Valorisez vos vendredis soirs', body: 'Piste IA un.' },
      { title: 'Comblez le mardi matin', body: 'Piste IA deux.' },
      { title: 'Misez sur les 17 – 30 ans', body: 'Piste IA trois.' },
    ]);

    const result = await runMonthlyReportSweep(silentLog, NOW);
    expect(result.generated).toBe(1);
    expect(pistesSpy).toHaveBeenCalledTimes(1); // once per report, at generation time
    const html = renderSpy.mock.calls[0]?.[0] ?? '';
    expect(html).toContain('Valorisez vos vendredis soirs'); // frozen into the stored PDF
    expect(html).not.toContain('Anticipez les temps forts');

    // idempotent second tick: no new report → no new generation either
    await runMonthlyReportSweep(silentLog, NOW);
    expect(pistesSpy).toHaveBeenCalledTimes(1);
  });

  it('a generator failure NEVER fails the report — it still stores, with the generic pistes (R2)', async () => {
    const owner = await seedUser();
    const venue = await seedVenueWithData(owner, 'Café Sans IA');
    vi.spyOn(storage, 'upload').mockImplementation(async (params) => ({ key: params.key }));
    pistesSpy.mockRejectedValue(new Error('anthropic exploded'));

    const result = await runMonthlyReportSweep(silentLog, NOW);
    expect(result).toEqual({ month: '2026-06', generated: 1, skipped: 0, failed: 0 });
    const html = renderSpy.mock.calls[0]?.[0] ?? '';
    expect(html).toContain('Anticipez les temps forts'); // the generic pistes carried the report
    expect(
      await db
        .select()
        .from(screenhostMonthlyReports)
        .where(eq(screenhostMonthlyReports.screenhostId, venue)),
    ).toHaveLength(1);
  });

  it('a venue with NO data is not a candidate at all', async () => {
    const owner = await seedUser();
    await db.insert(screenhosts).values({ name: 'Sans Données', ownerId: owner });
    vi.spyOn(storage, 'upload').mockResolvedValue({ key: 'unused' });

    const result = await runMonthlyReportSweep(silentLog, NOW);
    expect(result).toEqual({ month: '2026-06', generated: 0, skipped: 0, failed: 0 });
    expect(await db.select().from(screenhostMonthlyReports)).toHaveLength(0);
  });

  it("failure isolation: one venue's storage failure logs + continues; the other still generates", async () => {
    const ownerA = await seedUser();
    const ownerB = await seedUser();
    const venueA = await seedVenueWithData(ownerA, 'Café Qui Casse');
    const venueB = await seedVenueWithData(ownerB, 'Café Qui Marche');

    vi.spyOn(storage, 'upload').mockImplementation(async (params) =>
      params.key.includes(venueA) ? { error: 'disk full' } : { key: params.key },
    );

    const result = await runMonthlyReportSweep(silentLog, NOW);
    expect(result.month).toBe('2026-06');
    expect(result.generated).toBe(1);
    expect(result.failed).toBe(1);

    expect(
      await db
        .select()
        .from(screenhostMonthlyReports)
        .where(eq(screenhostMonthlyReports.screenhostId, venueA)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(screenhostMonthlyReports)
        .where(eq(screenhostMonthlyReports.screenhostId, venueB)),
    ).toHaveLength(1);
  });
});
