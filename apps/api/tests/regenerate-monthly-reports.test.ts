import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { monthBounds, regenerateStoredReports } from '../scripts/regenerate-monthly-reports.js';
import { db, sql } from '../src/db/client.js';
import {
  type NewUser,
  notifications,
  screenhostAffluence,
  screenhostMonthlyReports,
  screenhosts,
  users,
} from '../src/db/schema.js';
import { runMonthlyReportSweep } from '../src/lib/report/monthly-job.js';
import { storage } from '../src/storage/s3-storage.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// The R1.5 restyle regeneration — chromium mocked at the render seam, storage.upload spied,
// real Postgres (the monthly-job harness). The contract under test: same storage_key overwritten,
// generated_at bumped, and NO new notification for a restyle.
const renderSpy = vi.hoisted(() =>
  vi.fn(async (html: string) => {
    void html;
    return Buffer.from('%PDF-regen-fake');
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

const silentLog = {
  info: () => undefined,
  warn: () => undefined,
};

let seq = 0;
const seedUser = async (values: Partial<NewUser> = {}): Promise<string> => {
  seq += 1;
  const [u] = await db
    .insert(users)
    .values({
      email: `regen${seq}@example.com`,
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
  await db
    .insert(screenhostAffluence)
    .values({ screenhostId: id, dayOfWeek: 1, hour: 12, estimatedImpressions: 40 });
  return id;
};

// 2026-07-08 UTC noon — the previous closed month is June 2026 (the sweep seeds the stored row).
const NOW = new Date('2026-07-08T12:00:00Z');

const sweepLog = {
  ...silentLog,
  error: () => undefined,
  debug: () => undefined,
  fatal: () => undefined,
  trace: () => undefined,
  child: () => sweepLog,
  level: 'silent',
} as unknown as Parameters<typeof runMonthlyReportSweep>[0];

const storedRow = async (venueId: string) => {
  const [row] = await db
    .select()
    .from(screenhostMonthlyReports)
    .where(eq(screenhostMonthlyReports.screenhostId, venueId));
  return row;
};

afterAll(async () => {
  await sql.end();
});

describe('monthBounds', () => {
  it('resolves inclusive month bounds, leap February included', () => {
    expect(monthBounds('2026-06')).toEqual({ from: '2026-06-01', to: '2026-06-30' });
    expect(monthBounds('2025-12')).toEqual({ from: '2025-12-01', to: '2025-12-31' });
    expect(monthBounds('2028-02')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
  });
});

describe('regenerateStoredReports (real Postgres, mocked render/storage)', () => {
  beforeEach(async () => {
    await resetAuthTables();
    renderSpy.mockClear();
    vi.restoreAllMocks();
  });

  it('overwrites the SAME storage key, bumps generated_at, inserts NO new notification', async () => {
    const owner = await seedUser();
    const venue = await seedVenueWithData(owner, 'Café Restylé');
    const upload = vi
      .spyOn(storage, 'upload')
      .mockImplementation(async (params) => ({ key: params.key }));

    await runMonthlyReportSweep(sweepLog, NOW);
    const before = await storedRow(venue);
    expect(before?.storageKey).toBe(`reports/${venue}/2026-06.pdf`);
    expect(upload).toHaveBeenCalledTimes(1);

    // generated_at is compared strictly — give the clock room on a fast machine.
    await new Promise((resolve) => setTimeout(resolve, 25));

    const result = await regenerateStoredReports(silentLog);
    expect(result).toMatchObject({ scanned: 1, regenerated: 1, failed: 0 });
    expect(upload).toHaveBeenCalledTimes(2);
    expect(upload).toHaveBeenLastCalledWith({
      key: `reports/${venue}/2026-06.pdf`,
      body: expect.any(Buffer),
      contentType: 'application/pdf',
    });

    const after = await storedRow(venue);
    expect(after?.storageKey).toBe(before?.storageKey); // same object, overwritten in place
    expect(after?.generatedAt.getTime()).toBeGreaterThan(before?.generatedAt.getTime() ?? 0);

    // Restyle ≠ news: the owner keeps exactly the ONE notification the sweep inserted.
    const notifs = await db.select().from(notifications).where(eq(notifications.userId, owner));
    expect(notifs).toHaveLength(1);
  });

  it('--dry-run lists targets without rendering, uploading or touching rows', async () => {
    const owner = await seedUser();
    const venue = await seedVenueWithData(owner, 'Café Prudent');
    const upload = vi
      .spyOn(storage, 'upload')
      .mockImplementation(async (params) => ({ key: params.key }));
    await runMonthlyReportSweep(sweepLog, NOW);
    const before = await storedRow(venue);
    renderSpy.mockClear();
    upload.mockClear();

    const result = await regenerateStoredReports(silentLog, { dryRun: true });
    expect(result.scanned).toBe(1);
    expect(result.regenerated).toBe(0);
    expect(result.targets).toEqual([
      {
        screenhostId: venue,
        venueName: 'Café Prudent',
        month: '2026-06',
        storageKey: `reports/${venue}/2026-06.pdf`,
      },
    ]);
    expect(renderSpy).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
    const after = await storedRow(venue);
    expect(after?.generatedAt.getTime()).toBe(before?.generatedAt.getTime());
  });

  it("failure isolation: one row's storage failure logs + continues; the other regenerates", async () => {
    const ownerA = await seedUser();
    const ownerB = await seedUser();
    const venueA = await seedVenueWithData(ownerA, 'Café Qui Casse');
    const venueB = await seedVenueWithData(ownerB, 'Café Qui Marche');
    const upload = vi
      .spyOn(storage, 'upload')
      .mockImplementation(async (params) => ({ key: params.key }));
    await runMonthlyReportSweep(sweepLog, NOW);
    const beforeB = await storedRow(venueB);
    await new Promise((resolve) => setTimeout(resolve, 25));

    upload.mockImplementation(async (params) =>
      params.key.includes(venueA) ? { error: 'disk full' } : { key: params.key },
    );

    const result = await regenerateStoredReports(silentLog);
    expect(result.scanned).toBe(2);
    expect(result.regenerated).toBe(1);
    expect(result.failed).toBe(1);

    const afterA = await storedRow(venueA);
    const afterB = await storedRow(venueB);
    expect(afterB?.generatedAt.getTime()).toBeGreaterThan(beforeB?.generatedAt.getTime() ?? 0);
    // The failed row keeps its original generated_at (nothing was overwritten for it).
    expect(afterA?.generatedAt.getTime()).toBeLessThan(afterB?.generatedAt.getTime() ?? 0);
  });
});
