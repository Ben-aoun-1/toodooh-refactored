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
import {
  lastClosedMonths,
  monthBounds,
  previousClosedMonth,
  runMonthlyReportSweep,
} from '../src/lib/report/monthly-job.js';
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

// R3 — the AI pistes seam (now yielding the single Piste 02 body), mocked at the module boundary
// (no key/SDK in this suite). Default: null → the generic Piste 02 body, exactly like an
// unprovisioned box.
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

// 2026-07-08 UTC noon — Tunis July 8th; the previous closed month is June 2026, and the R2
// catch-up window covers June, May and April.
const NOW = new Date('2026-07-08T12:00:00Z');
const MONTHS = ['2026-06', '2026-05', '2026-04'];

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

  // REV2 commit 3 — the extraction of the facture line aggregation rests on exactly one
  // assumption: the window derived from a stored 'YYYY-MM' key is the SAME window the sweep used
  // when it emitted that facture. If it were not, the PDF and the detail screen could aggregate
  // different days and the owner would sign a document the screen contradicts.
  it('monthBounds(month) reproduces previousClosedMonth’s window from the key alone', () => {
    for (const now of [
      new Date('2026-07-08T12:00:00Z'),
      new Date('2026-01-15T12:00:00Z'),
      new Date('2024-03-10T12:00:00Z'), // February in a leap year
      new Date('2026-12-31T22:00:00Z'),
    ]) {
      const closed = previousClosedMonth(now);
      expect(monthBounds(closed.month)).toEqual(closed);
    }
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

describe('lastClosedMonths (PERF-QA1 R2 — the bounded catch-up window)', () => {
  it('returns the last 3 closed months with exact bounds, newest first', () => {
    expect(lastClosedMonths(NOW, 3)).toEqual([
      { month: '2026-06', from: '2026-06-01', to: '2026-06-30' },
      { month: '2026-05', from: '2026-05-01', to: '2026-05-31' },
      { month: '2026-04', from: '2026-04-01', to: '2026-04-30' },
    ]);
  });

  it('walks across the year boundary', () => {
    expect(lastClosedMonths(new Date('2026-02-10T12:00:00Z'), 3).map((m) => m.month)).toEqual([
      '2026-01',
      '2025-12',
      '2025-11',
    ]);
  });

  it('count 1 degenerates to previousClosedMonth alone', () => {
    expect(lastClosedMonths(NOW, 1)).toEqual([previousClosedMonth(NOW)]);
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

  it('generates + stores + notifies ONCE per catch-up month; the second tick is a no-op', async () => {
    const owner = await seedUser();
    const venue = await seedVenueWithData(owner, 'Café Mensuel');
    const upload = vi
      .spyOn(storage, 'upload')
      .mockImplementation(async (params) => ({ key: params.key }));

    // R2 — a venue with data and NO reports gets all 3 catch-up months in one tick.
    const first = await runMonthlyReportSweep(silentLog, NOW);
    expect(first).toEqual({ months: MONTHS, generated: 3, skipped: 0, failed: 0 });
    for (const month of MONTHS) {
      expect(upload).toHaveBeenCalledWith(
        expect.objectContaining({
          key: `reports/${venue}/${month}.pdf`,
          contentType: 'application/pdf',
        }),
      );
    }

    const rows = await db
      .select()
      .from(screenhostMonthlyReports)
      .where(eq(screenhostMonthlyReports.screenhostId, venue));
    expect(rows.map((r) => r.month).sort()).toEqual(['2026-04', '2026-05', '2026-06']);
    expect(rows.find((r) => r.month === '2026-06')?.storageKey).toBe(
      `reports/${venue}/2026-06.pdf`,
    );

    const notifs = await db.select().from(notifications).where(eq(notifications.userId, owner));
    expect(notifs).toHaveLength(3);
    expect(new Set(notifs.map((n) => n.type))).toEqual(new Set(['monthly_report_ready']));
    const bodies = notifs.map((n) => n.body ?? '').join('\n');
    expect(bodies).toContain('juin 2026');
    expect(bodies).toContain('mai 2026');
    expect(bodies).toContain('avril 2026');
    expect(bodies).toContain('Café Mensuel');

    // Second tick: idempotent — no new render, no new rows, no second notification.
    const second = await runMonthlyReportSweep(silentLog, NOW);
    expect(second).toEqual({ months: MONTHS, generated: 0, skipped: 3, failed: 0 });
    expect(
      await db
        .select()
        .from(screenhostMonthlyReports)
        .where(eq(screenhostMonthlyReports.screenhostId, venue)),
    ).toHaveLength(3);
    expect(
      await db.select().from(notifications).where(eq(notifications.userId, owner)),
    ).toHaveLength(3);
  });

  // R2 — the catch-up heart: a month the sweep MISSED (api down over a month boundary…) is
  // generated on the next tick, months that exist are skipped, and only the NEW month notifies.
  it('a missed middle month self-heals; existing months are skipped and not re-notified', async () => {
    const owner = await seedUser();
    const venue = await seedVenueWithData(owner, 'Café Rattrapage');
    vi.spyOn(storage, 'upload').mockImplementation(async (params) => ({ key: params.key }));
    await db.insert(screenhostMonthlyReports).values([
      { screenhostId: venue, month: '2026-06', storageKey: `reports/${venue}/2026-06.pdf` },
      { screenhostId: venue, month: '2026-04', storageKey: `reports/${venue}/2026-04.pdf` },
    ]);

    const result = await runMonthlyReportSweep(silentLog, NOW);
    expect(result).toEqual({ months: MONTHS, generated: 1, skipped: 2, failed: 0 });
    const rows = await db
      .select()
      .from(screenhostMonthlyReports)
      .where(eq(screenhostMonthlyReports.screenhostId, venue));
    expect(rows.map((r) => r.month).sort()).toEqual(['2026-04', '2026-05', '2026-06']);

    const notifs = await db.select().from(notifications).where(eq(notifications.userId, owner));
    expect(notifs).toHaveLength(1);
    expect(notifs[0]?.body).toContain('mai 2026');
  });

  it('calls the AI pistes generator ONCE per generated report and freezes its output (R3)', async () => {
    const owner = await seedUser();
    await seedVenueWithData(owner, 'Café IA');
    vi.spyOn(storage, 'upload').mockImplementation(async (params) => ({ key: params.key }));
    pistesSpy.mockResolvedValue('Corps IA du créneau faible.');

    const result = await runMonthlyReportSweep(silentLog, NOW);
    expect(result.generated).toBe(3);
    expect(pistesSpy).toHaveBeenCalledTimes(3); // once per generated report, at generation time
    const html = renderSpy.mock.calls[0]?.[0] ?? '';
    expect(html).toContain('Corps IA du créneau faible.'); // frozen into the stored PDF
    expect(html).toContain('Repérez vos angles morts'); // under the FIXED Piste 02 title
    expect(html).not.toContain('Comparez vos créneaux les plus forts'); // the generic body is displaced

    // idempotent second tick: no new report → no new generation either
    await runMonthlyReportSweep(silentLog, NOW);
    expect(pistesSpy).toHaveBeenCalledTimes(3);
  });

  it('a generator failure NEVER fails the report — it still stores, with the generic Piste 02 body (R3)', async () => {
    const owner = await seedUser();
    const venue = await seedVenueWithData(owner, 'Café Sans IA');
    vi.spyOn(storage, 'upload').mockImplementation(async (params) => ({ key: params.key }));
    pistesSpy.mockRejectedValue(new Error('anthropic exploded'));

    const result = await runMonthlyReportSweep(silentLog, NOW);
    expect(result).toEqual({ months: MONTHS, generated: 3, skipped: 0, failed: 0 });
    const html = renderSpy.mock.calls[0]?.[0] ?? '';
    expect(html).toContain('Comparez vos créneaux les plus forts'); // the generic body carried the report
    expect(
      await db
        .select()
        .from(screenhostMonthlyReports)
        .where(eq(screenhostMonthlyReports.screenhostId, venue)),
    ).toHaveLength(3);
  });

  it('a venue with NO data is not a candidate at all', async () => {
    const owner = await seedUser();
    await db.insert(screenhosts).values({ name: 'Sans Données', ownerId: owner });
    vi.spyOn(storage, 'upload').mockResolvedValue({ key: 'unused' });

    const result = await runMonthlyReportSweep(silentLog, NOW);
    expect(result).toEqual({ months: MONTHS, generated: 0, skipped: 0, failed: 0 });
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
    expect(result.months).toEqual(MONTHS);
    expect(result.generated).toBe(3); // venueB — all three catch-up months
    expect(result.failed).toBe(3); // venueA — fails per month, never starves venueB

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
    ).toHaveLength(3);
  });
});
