import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { db, sql } from '../src/db/client.js';
import {
  type NewUser,
  campaignReconciliation,
  campaignScreenhostPayout,
  campaigns,
  creatives,
  events,
  proofOfPlay,
  screenhostAffluence,
  screenhostMonthlyStats,
  screenhosts,
  screens,
  users,
} from '../src/db/schema.js';
import { assembleReportData, heatmapKinds, heatmapLevels } from '../src/lib/report/assemble.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// Integration — real Postgres. assembleReportData must read through the SAME tables the owner
// reads use and derive the template inputs with the page's semantics (flags, zero-fill, hachure).

let seq = 0;
const seedUser = async (values: Partial<NewUser> = {}): Promise<string> => {
  seq += 1;
  const [u] = await db
    .insert(users)
    .values({
      email: `rep${seq}@example.com`,
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
  values: Partial<typeof screenhosts.$inferInsert> = {},
): Promise<string> => {
  const [s] = await db
    .insert(screenhosts)
    .values({ name: 'Café Rapport', ownerId, ...values })
    .returning();
  return s?.id ?? '';
};

const RANGE = { from: '2026-06-01', to: '2026-06-30' };
const TODAY = '2026-07-08';

afterAll(async () => {
  await sql.end();
});

describe('assembleReportData (real Postgres)', () => {
  beforeEach(async () => {
    await resetAuthTables();
    // events survive the auth truncate (their only user FK is ON DELETE SET NULL) and the
    // teaser read is NETWORK-wide, not venue-scoped — so this file clears them explicitly.
    await db.delete(events);
  });

  it('returns null for a missing venue', async () => {
    expect(
      await assembleReportData('11111111-1111-4111-8111-111111111111', RANGE, TODAY),
    ).toBeNull();
  });

  it('EMPTY venue → both flags false, pending-shaped data', async () => {
    const owner = await seedUser();
    const venue = await seedScreenhost(owner, { name: 'Café Sans Données' });

    const data = await assembleReportData(venue, RANGE, TODAY);
    expect(data).not.toBeNull();
    expect(data?.hostHasData).toBe(false);
    expect(data?.castHasData).toBe(false);
    expect(data?.kpis).toEqual({ global: 0, perDay: null, perHour: null, peak: null });
    expect(data?.days).toEqual([]);
    expect(data?.breakdown).toBeNull();
    expect(data?.revenue.count).toBe(0);
    expect(data?.campaignsBlock.rows).toEqual([]);
    // all-hachure heatmap: 7×14 zeros — and AFF1's explanatory empty state (no data at all).
    expect(data?.heatLevels.flat().every((lvl) => lvl === 0)).toBe(true);
    expect(data?.heatKinds.flat().every((kind) => kind === 'none')).toBe(true);
    expect(data?.heatEmpty).toBe(true);
  });

  it('FULL venue → flags true, period KPIs, zero-filled days, revenue + campaign rows', async () => {
    const owner = await seedUser();
    const advertiser = await seedUser({ role: 'advertiser' });
    const venue = await seedScreenhost(owner, {
      name: 'Café Le Palmier',
      openingHour: 8,
      closingHour: 22,
      genderMalePct: '48',
      genderFemalePct: '52',
      age17To30Pct: '34',
      age31To45Pct: '29',
      age46To60Pct: '18',
      age60PlusPct: '10',
    });

    // HOST side: one monthly-stats month + a couple of affluence slots.
    await db.insert(screenhostMonthlyStats).values({
      screenhostId: venue,
      month: '2026-06',
      totalAudience: 2100,
      daily: [
        { date: '2026-06-01', audience: 700 },
        { date: '2026-06-14', audience: 900 },
        { date: '2026-06-20', audience: 500 },
      ],
      peakDayOfWeek: 6,
      peakHour: 13,
    });
    await db.insert(screenhostAffluence).values([
      { screenhostId: venue, dayOfWeek: 1, hour: 12, estimatedImpressions: 80, source: 'measured' },
      { screenhostId: venue, dayOfWeek: 6, hour: 18, estimatedImpressions: 120, source: 'backup' },
      { screenhostId: venue, dayOfWeek: 3, hour: 15, estimatedImpressions: 30, source: null },
    ]);

    // CAST side: a proof chain (2 VIDEO_ENDED on June 10) + one reconciled payout line.
    const [screen] = await db
      .insert(screens)
      .values({ screenhostId: venue, name: 'Screen 1' })
      .returning();
    const [creative] = await db
      .insert(creatives)
      .values({
        advertiserId: advertiser,
        creativeType: 'video',
        storageKey: `creatives/${advertiser}/report`,
        durationSeconds: 20,
        validationStatus: 'approved',
      })
      .returning();
    const [campaign] = await db
      .insert(campaigns)
      .values({
        advertiserId: advertiser,
        name: 'Ooredoo · Forfait Data',
        campaignType: 'standard',
        status: 'active',
        creativeId: creative?.id,
        startDate: '2026-06-05',
        endDate: '2026-06-18',
      })
      .returning();
    await db.insert(proofOfPlay).values(
      Array.from({ length: 2 }, () => ({
        screenId: screen?.id ?? '',
        screenhostId: venue,
        campaignId: campaign?.id ?? '',
        creativeId: creative?.id ?? '',
        videoIdAsSent: campaign?.id ?? '',
        eventType: 'VIDEO_ENDED' as const,
        receivedAt: new Date('2026-06-10T12:00:00Z'),
      })),
    );
    const [recon] = await db
      .insert(campaignReconciliation)
      .values({
        campaignId: campaign?.id ?? '',
        expectedImp: 0,
        deliveredImp: 0,
        manquementImp: 0,
        pPerteTnd: '0',
        refundTnd: '0',
        spendTnd: '0',
        status: 'reussie',
        reconciledBy: advertiser,
      })
      .returning();
    await db.insert(campaignScreenhostPayout).values({
      reconciliationId: recon?.id ?? '',
      campaignId: campaign?.id ?? '',
      screenhostId: venue,
      expectedImp: 1000,
      deliveredImp: 800,
      earningsTnd: '412',
    });

    const data = await assembleReportData(venue, RANGE, TODAY);
    expect(data).not.toBeNull();
    expect(data?.hostHasData).toBe(true);
    expect(data?.castHasData).toBe(true);

    // S01 — the three June daily points; hours span 14 (8→22).
    expect(data?.kpis.global).toBe(2100);
    expect(data?.kpis.perDay).toBe(700);
    expect(data?.kpis.perHour).toBe(50);
    expect(data?.kpis.peak).toEqual({ value: 900, date: '2026-06-14' });

    // S03 — zero-filled June: 30 days, 2 impressions on the 10th, 0 elsewhere.
    expect(data?.days).toHaveLength(30);
    expect(data?.days.find((d) => d.date === '2026-06-10')?.impressions).toBe(2);
    expect(data?.days.find((d) => d.date === '2026-06-11')?.impressions).toBe(0);

    // S04 — ratios × global audience.
    expect(data?.breakdown?.femmes).toBe(1092);
    expect(data?.breakdown?.hommes).toBe(1008);

    // S05/S06 — the reconciled line, period-overlapping, Passée by 2026-07-08.
    expect(data?.revenue.count).toBe(1);
    expect(data?.revenue.rows[0]?.name).toBe('Ooredoo · Forfait Data');
    expect(data?.revenue.rows[0]?.period).toBe('05/06 – 18/06');
    expect(data?.campaignsBlock.rows[0]?.statut).toBe('Passée');
    expect(data?.campaignsBlock.cumulativeImpressions).toBe(800);
    expect(data?.campaignsBlock.top3).toEqual(['Ooredoo · Forfait Data']);

    // S02 — AFF1: the MERGED typical-week grid WITH provenance (the page's rule, api-side).
    // Mon 12h measured 80 → col 4; Sat 18h backup 120 → col 10; Wed 15h NULL-source 30 → col 7
    // reads as an estimation. Everything else: no data → level 0 / none.
    const levels = data?.heatLevels ?? [];
    const kinds = data?.heatKinds ?? [];
    expect(levels).toHaveLength(7);
    expect(levels[0]?.[4]).toBeGreaterThan(0);
    expect(kinds[0]?.[4]).toBe('measured');
    expect(levels[5]?.[10]).toBe(5); // the max of the three
    expect(kinds[5]?.[10]).toBe('backup');
    expect(levels[2]?.[7]).toBeGreaterThan(0);
    expect(kinds[2]?.[7]).toBe('backup'); // NULL source with a value → estimation, never measured
    expect(levels[1]?.[4]).toBe(0);
    expect(kinds[1]?.[4]).toBe('none');
    expect(data?.heatEmpty).toBe(false);
  });
});

describe('heatmapLevels / heatmapKinds', () => {
  const measuredAll = Array.from({ length: 7 }, () =>
    Array.from({ length: 24 }, () => 'measured' as const),
  );
  it('closed hours are level 0 regardless of value; null hours mean nothing is closed', () => {
    const grid = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 10));
    const withHours = heatmapLevels(grid, measuredAll, 9, 20);
    expect(withHours[0]?.[0]).toBe(0); // 8h < opening 9h → closed
    expect(withHours[0]?.[1]).toBeGreaterThan(0); // 9h open
    expect(withHours[0]?.[12]).toBe(0); // 20h ≥ closing → closed
    const noHours = heatmapLevels(grid, measuredAll, null, null);
    expect(noHours.flat().every((lvl) => lvl > 0)).toBe(true);
  });

  it('a backup cell keeps its ramp level (same scale) and is flagged by heatmapKinds', () => {
    const grid = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
    const sources: ('measured' | 'backup' | null)[][] = Array.from({ length: 7 }, () =>
      Array.from({ length: 24 }, () => null),
    );
    grid[0]![9] = 10;
    sources[0]![9] = 'measured';
    grid[0]![10] = 10;
    sources[0]![10] = 'backup';
    const levels = heatmapLevels(grid, sources, null, null);
    const kinds = heatmapKinds(grid, sources, null, null);
    expect(levels[0]?.[1]).toBe(levels[0]?.[2]); // 9h and 10h: same value → same level
    expect(kinds[0]?.[1]).toBe('measured');
    expect(kinds[0]?.[2]).toBe('backup');
    expect(kinds[0]?.[3]).toBe('none');
    expect(kinds).toHaveLength(7);
    expect(kinds[0]).toHaveLength(14);
  });

  it('a measured ZERO is level 1 (a measurement), a provenance-less zero is level 0 (no data)', () => {
    const grid = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
    const sources: ('measured' | 'backup' | null)[][] = Array.from({ length: 7 }, () =>
      Array.from({ length: 24 }, () => null),
    );
    grid[0]![9] = 8;
    sources[0]![9] = 'measured';
    sources[0]![10] = 'measured'; // measured 0
    const levels = heatmapLevels(grid, sources, null, null);
    expect(levels[0]?.[1]).toBe(5);
    expect(levels[0]?.[2]).toBe(1);
    expect(levels[0]?.[3]).toBe(0);
  });
});

// ── PERF-QA2 — Piste 01's teaser input ────────────────────────────────────────────────────────
describe('assembleReportData — upcomingEvents (the Piste 01 window)', () => {
  const kickoff = (dayIso: string): Date => new Date(`${dayIso}T18:00:00+01:00`); // Tunis

  beforeEach(async () => {
    await resetAuthTables();
    await db.delete(events);
  });

  const seedEvent = async (
    dayIso: string,
    over: Partial<typeof events.$inferInsert> = {},
  ): Promise<void> => {
    await db.insert(events).values({
      name: `Match ${dayIso}`,
      kickoffAt: kickoff(dayIso),
      endsAt: new Date(kickoff(dayIso).getTime() + 2 * 60 * 60 * 1000),
      ...over,
    });
  };

  it('counts OFFICIAL, non-cancelled events inside the 14-day window and dates the soonest', async () => {
    const venue = await seedScreenhost(await seedUser());
    await seedEvent('2026-07-09'); // J+1
    await seedEvent('2026-07-22'); // J+14 — the last day of the window
    const data = await assembleReportData(venue, RANGE, TODAY);
    expect(data?.upcomingEvents).toEqual({ count: 2, soonestInDays: 1 });
  });

  it('a kickoff TODAY counts (soonestInDays 0); J+15 falls outside', async () => {
    const venue = await seedScreenhost(await seedUser());
    await seedEvent(TODAY);
    await seedEvent('2026-07-23'); // J+15
    const data = await assembleReportData(venue, RANGE, TODAY);
    expect(data?.upcomingEvents).toEqual({ count: 1, soonestInDays: 0 });
  });

  it('suggested, cancelled and PAST events never reach the report', async () => {
    const venue = await seedScreenhost(await seedUser());
    await seedEvent('2026-07-10', { source: 'suggested' });
    await seedEvent('2026-07-11', { annule: true });
    await seedEvent('2026-07-07'); // yesterday
    expect((await assembleReportData(venue, RANGE, TODAY))?.upcomingEvents).toBeNull();
  });

  it('an empty catalogue is null, not a zero count', async () => {
    const venue = await seedScreenhost(await seedUser());
    expect((await assembleReportData(venue, RANGE, TODAY))?.upcomingEvents).toBeNull();
  });
});
