import { and, eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { runMonthlyAudienceBackfill, monthsBetween } from '../scripts/backfill-monthly-audience.js';
import { db, sql } from '../src/db/client.js';
import {
  type NewUser,
  screenhostAffluence,
  screenhostMonthlyStats,
  screenhosts,
  users,
} from '../src/db/schema.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// PERF-QA2 — the backfill walk. A JOB, not a migration (ruled 2026-08-20): prod migrations run on
// service start and an audience rewrite must never ride a deploy. DRY-RUN by default; --execute
// writes; re-running is a no-op on closed months (the idempotence proof this file exists for).

let seq = 0;
const seedUser = async (values: Partial<NewUser> = {}): Promise<string> => {
  seq += 1;
  const [u] = await db
    .insert(users)
    .values({
      email: `bf${seq}@example.com`,
      contactName: `User ${seq}`,
      role: 'individual_owner',
      status: 'approved',
      ...values,
    })
    .returning();
  return u?.id ?? '';
};

const seedVenue = async (name = 'Café Backfill'): Promise<string> => {
  const [s] = await db
    .insert(screenhosts)
    .values({ name, ownerId: await seedUser() })
    .returning();
  return s?.id ?? '';
};

/** Mon–Fri 10/20/30 at 10h/11h/12h (Σ 60/day); weekend closed. createdAt = the grid's birth. */
const seedGrid = async (venueId: string, createdAt: Date): Promise<void> => {
  const rows = [];
  for (let day = 1; day <= 5; day += 1) {
    for (const [hour, value] of [
      [10, 10],
      [11, 20],
      [12, 30],
    ] as const) {
      rows.push({
        screenhostId: venueId,
        dayOfWeek: day,
        hour,
        estimatedImpressions: value,
        createdAt,
      });
    }
  }
  await db.insert(screenhostAffluence).values(rows);
};

const zeroDaily = (month: string, days: number) =>
  Array.from({ length: days }, (_, i) => ({
    date: `${month}-${String(i + 1).padStart(2, '0')}`,
    audience: 0,
  }));

const storedRow = async (venueId: string, month: string) => {
  const [row] = await db
    .select()
    .from(screenhostMonthlyStats)
    .where(
      and(
        eq(screenhostMonthlyStats.screenhostId, venueId),
        eq(screenhostMonthlyStats.month, month),
      ),
    );
  return row;
};

const NOW = new Date('2026-07-08T09:00:00+01:00'); // Tunis 2026-07-08
const GRID_BIRTH = new Date('2026-06-01T09:00:00+01:00');

afterAll(async () => {
  await sql.end();
});

describe('monthsBetween', () => {
  it('walks inclusive month bounds and refuses an inverted range', () => {
    expect(monthsBetween('2026-05', '2026-07')).toEqual(['2026-05', '2026-06', '2026-07']);
    expect(monthsBetween('2026-07', '2026-07')).toEqual(['2026-07']);
    expect(monthsBetween('2026-08', '2026-07')).toEqual([]);
  });
});

describe('runMonthlyAudienceBackfill (real Postgres)', () => {
  beforeEach(async () => {
    await resetAuthTables();
    await db.delete(screenhostMonthlyStats);
    await db.delete(screenhostAffluence);
  });

  it('DRY-RUN reports the before/after inventory and writes NOTHING', async () => {
    const venue = await seedVenue();
    await seedGrid(venue, GRID_BIRTH);
    await db.insert(screenhostMonthlyStats).values({
      screenhostId: venue,
      month: '2026-06',
      totalAudience: 0,
      daily: zeroDaily('2026-06', 30),
      peakDayOfWeek: 1,
      peakHour: 12,
    });

    const report = await runMonthlyAudienceBackfill(NOW);
    const june = report.rows.find((r) => r.month === '2026-06');
    expect(june?.action).toBe('update');
    expect(june?.beforeTotal).toBe(0);
    expect(june?.afterTotal).toBe(1320); // 22 weekdays × 60
    expect(june?.estimatedDays).toBe(30);

    const after = await storedRow(venue, '2026-06');
    expect(after?.totalAudience).toBe(0); // untouched by the dry run
  });

  it('--execute writes the merged totals, and a SECOND run changes nothing (idempotence)', async () => {
    const venue = await seedVenue();
    await seedGrid(venue, GRID_BIRTH);
    await db.insert(screenhostMonthlyStats).values({
      screenhostId: venue,
      month: '2026-06',
      totalAudience: 0,
      daily: zeroDaily('2026-06', 30),
      peakDayOfWeek: 1,
      peakHour: 12,
    });

    await runMonthlyAudienceBackfill(NOW, { execute: true });
    const written = await storedRow(venue, '2026-06');
    expect(written?.totalAudience).toBe(1320);
    expect(written?.daily.every((d) => d.source === 'estimated')).toBe(true);

    const second = await runMonthlyAudienceBackfill(NOW, { execute: true });
    expect(second.rows.find((r) => r.month === '2026-06')?.action).toBe('unchanged');
    expect(second.totals.updated).toBe(0);
    const again = await storedRow(venue, '2026-06');
    expect(again?.totalAudience).toBe(1320);
    expect(again?.updatedAt).toEqual(written?.updatedAt); // no write at all
  });

  it('CREATES missing venue-months over the grid lifetime, never before it', async () => {
    const venue = await seedVenue();
    await seedGrid(venue, GRID_BIRTH); // the grid was born in June

    const report = await runMonthlyAudienceBackfill(NOW, { execute: true });
    expect(report.rows.map((r) => r.month)).toEqual(['2026-06', '2026-07']);
    expect(report.totals.created).toBe(2);

    const rows = await db
      .select()
      .from(screenhostMonthlyStats)
      .where(eq(screenhostMonthlyStats.screenhostId, venue));
    expect(rows).toHaveLength(2);
    // July is the CURRENT month: it stops at Tunis today, so it is smaller than a full month.
    const july = rows.find((r) => r.month === '2026-07');
    expect(july?.daily.at(-1)?.date).toBe('2026-07-08');
    expect(july?.totalAudience).toBe(360); // 6 weekdays (1–3, 6–8) × 60
  });

  it('a fully MEASURED month is left exactly as the hub wrote it (DATA1 stays out of scope)', async () => {
    const venue = await seedVenue();
    await seedGrid(venue, GRID_BIRTH);
    // Every day measured, and a hub total that deliberately disagrees with Σ of its days.
    const daily = Array.from({ length: 30 }, (_, i) => ({
      date: `2026-06-${String(i + 1).padStart(2, '0')}`,
      audience: 100,
    }));
    await db.insert(screenhostMonthlyStats).values({
      screenhostId: venue,
      month: '2026-06',
      totalAudience: 3010, // ≠ Σ daily (3000) — the banked DATA1 mismatch, preserved
      daily,
      peakDayOfWeek: 1,
      peakHour: 12,
    });

    const report = await runMonthlyAudienceBackfill(NOW, { execute: true });
    expect(report.rows.find((r) => r.month === '2026-06')?.action).toBe('unchanged');
    const row = await storedRow(venue, '2026-06');
    expect(row?.totalAudience).toBe(3010);
    expect(row?.daily[0]?.source).toBeUndefined(); // markers are not stamped on measured rows
  });

  it('a venue with NO grid is never scanned (nothing to estimate from)', async () => {
    await seedVenue('Café Sans Grille');
    const report = await runMonthlyAudienceBackfill(NOW, { execute: true });
    expect(report.venuesScanned).toBe(0);
    expect(report.rows).toEqual([]);
  });

  it('--venue scopes the walk to one venue', async () => {
    const a = await seedVenue('Café A');
    const b = await seedVenue('Café B');
    await seedGrid(a, GRID_BIRTH);
    await seedGrid(b, GRID_BIRTH);
    const report = await runMonthlyAudienceBackfill(NOW, { onlyVenue: a });
    expect(report.venuesScanned).toBe(1);
    expect(new Set(report.rows.map((r) => r.screenhostId))).toEqual(new Set([a]));
  });
});
