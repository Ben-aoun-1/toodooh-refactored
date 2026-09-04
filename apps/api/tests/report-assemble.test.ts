import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { db, sql } from '../src/db/client.js';
import {
  type NewUser,
  campaignReconciliation,
  campaignScreenhostPayout,
  campaigns,
  creatives,
  eventAttestations,
  events,
  proofOfPlay,
  screenhostAffluence,
  screenhostAffluenceHourly,
  screenhostMonthlyStats,
  screenhosts,
  screens,
  users,
} from '../src/db/schema.js';
import { loadPeriodAudienceInput } from '../src/lib/period-audience-source.js';
import { periodAudience } from '../src/lib/period-audience.js';
import { assembleReportData, heatmapKinds, heatmapLevels } from '../src/lib/report/assemble.js';

import { resetAuthTables, bothHalves } from './helpers/db-test-setup.js';

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

// MEJ-R1 — created_at is the venue's ONBOARDING day and the floor under the backup grid, so
// every fixture states one. The default predates RANGE (June 2026): these cases assert the
// merge, not the floor, which has its own case at the end of the file.
const ONBOARDED_BEFORE_RANGE = new Date('2026-05-01T00:00:00Z');

const seedScreenhost = async (
  ownerId: string,
  values: Partial<typeof screenhosts.$inferInsert> = {},
): Promise<string> => {
  const [s] = await db
    .insert(screenhosts)
    .values({ name: 'Café Rapport', ownerId, createdAt: ONBOARDED_BEFORE_RANGE, ...values })
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
    expect(data?.kpis).toEqual({
      global: 0,
      perDay: null,
      perHour: null,
      peak: null,
      measuredDays: 0,
      estimatedPct: null,
    });
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
      age46PlusPct: '28',
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
    await db.insert(screenhostAffluence).values(
      bothHalves([
        {
          screenhostId: venue,
          dayOfWeek: 1,
          hour: 12,
          estimatedImpressions: 80,
          source: 'measured',
        },
        {
          screenhostId: venue,
          dayOfWeek: 6,
          hour: 18,
          estimatedImpressions: 120,
          source: 'backup',
        },
        { screenhostId: venue, dayOfWeek: 3, hour: 15, estimatedImpressions: 30, source: null },
      ]),
    );

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

    // S01 — PERF-R1: the MERGED période (supersedes US-P.5 measured-only). 3 measured days
    // (700 + 900 + 500) + the grid standing in for the silent ones: Mondays 08/15/22/29 → 4×80,
    // Wednesdays 03/10/17/24 → 4×30, Saturdays 06/13/27 → 3×120 (the 20th is measured). Days
    // with neither measure nor grid value are NOT data days — 14 data days in June.
    //
    // FLOW-1 — a grid HOUR fills both halves, and a day is now the SUM of its cells, so each grid
    // day is worth twice its hourly figure: 800 → 1 600. The three measured days arrive at DAY
    // granularity from monthly_stats and are untouched by this lane: 2 100 + 1 600 = 3 700.
    expect(data?.kpis.global).toBe(3700);
    expect(data?.kpis.perDay).toBe(264); // 3700 / 14
    expect(data?.kpis.perHour).toBe(18.9); // 264.28… / 14 h, one decimal
    expect(data?.kpis.peak).toEqual({ value: 900, date: '2026-06-14' });
    expect(data?.kpis.measuredDays).toBe(3);
    // Slice C — the caption is VALUE-WEIGHTED: Σ estimated audience / Σ all audience, so it is
    // granularity-independent (a day is a day whether it arrives as one point or forty-eight).
    // Here: (4 Mondays × 80 + 4 Wednesdays × 30 + 3 Saturdays × 120) × 2 halves = 1 600 estimated,
    // against 1 600 + 2 100 of measured day-granularity history = 3 700. A share of ROWS would have
    // said 88 % of the same data — the number a reader would have taken to mean people.
    //
    // ⚠️ This share MOVES with FLOW-1 (28 % → 43 %) and that is correct, not a regression: the
    // estimated side is cell-granular and doubles, while the measured side is day-granular history
    // that never carried the 0.5. The ratio only cancelled when BOTH sides were cells.
    expect(data?.kpis.estimatedPct).toBe(43); // 1 600 / 3 700

    // S03 — zero-filled June: 30 days, 2 impressions on the 10th, 0 elsewhere.
    expect(data?.days).toHaveLength(30);
    expect(data?.days.find((d) => d.date === '2026-06-10')?.impressions).toBe(2);
    expect(data?.days.find((d) => d.date === '2026-06-11')?.impressions).toBe(0);

    // S04 — ratios × the MERGED global audience, which FLOW-1 moved from 2 900 to 3 700. The
    // breakdown is a pure share of that total, so every figure scales with it; the RATIOS are
    // untouched. CLS-AGE1: the venue carries the THREE-band shape (46+ = 28 %, the old 18 + 10),
    // and `ratiosOrNull` gates on exactly those five columns — a fixture in the retired shape
    // would leave `breakdown` null and take every line below with it.
    expect(data?.breakdown?.femmes).toBe(1924); // 52 % of 3 700
    expect(data?.breakdown?.hommes).toBe(1776); // 48 %
    expect(data?.breakdown?.ages.map((b) => [b.label, b.count])).toEqual([
      ['17 – 30 ans', 1258], // 34 %
      ['31 – 45 ans', 1073], // 29 %
      ['46 ans et plus', 1036], // 28 %
    ]);

    // S05/S06 — the reconciled line, period-overlapping, Passée by 2026-07-08.
    expect(data?.revenue.count).toBe(1);
    expect(data?.revenue.rows[0]?.name).toBe('Ooredoo · Forfait Data');
    expect(data?.revenue.rows[0]?.period).toBe('05/06 – 18/06');
    expect(data?.campaignsBlock.rows[0]?.statut).toBe('Passée');
    expect(data?.campaignsBlock.cumulativeImpressions).toBe(800);
    expect(data?.campaignsBlock.top3).toEqual(['Ooredoo · Forfait Data']);

    // S02 — AUD-HOURLY1-C: the PÉRIODE'S OWN cells folded into weekday × hour. This venue has no
    // hourly cells, so every slot the merge fills comes from the admin's grid and is therefore an
    // ESTIMATION — whatever the hub had marked on its own rolling slot. (A measured slot needs a
    // screenhost_affluence_hourly cell; that path is pinned in screenhost-affluence.test.ts.)
    // Slice C — the window is 28 SLOT columns starting at 8h00, so hour h occupies columns
    // (h − 8) × 2 and + 1. Mon 12h 80 → cols 8/9; Sat 18h 120 → cols 20/21; Wed 15h 30 → cols
    // 14/15. An hour-shaped grid fills BOTH halves, so each pair reads the same.
    const levels = data?.heatLevels ?? [];
    const kinds = data?.heatKinds ?? [];
    expect(levels).toHaveLength(7);
    expect(levels[0]).toHaveLength(28);
    expect(levels[0]?.[8]).toBeGreaterThan(0);
    expect(levels[0]?.[9]).toBe(levels[0]?.[8]); // the hour's other half, same value
    expect(kinds[0]?.[8]).toBe('backup');
    expect(kinds[0]?.[9]).toBe('backup');
    expect(levels[5]?.[20]).toBe(5); // the max of the three
    expect(kinds[5]?.[20]).toBe('backup');
    expect(levels[2]?.[14]).toBeGreaterThan(0);
    expect(kinds[2]?.[14]).toBe('backup');
    expect(levels[1]?.[8]).toBe(0);
    expect(kinds[1]?.[8]).toBe('none');
    expect(data?.heatEmpty).toBe(false);
  });

  it('PERF-R1: a venue with ZERO readings gets non-zero S01 numbers from the backup grid', async () => {
    const owner = await seedUser();
    const venue = await seedScreenhost(owner, {
      name: 'Café Sans Capteur',
      openingHour: 8,
      closingHour: 22,
    });
    // No monthly-stats at all — only the admin's backup grid, every weekday at 10h.
    await db.insert(screenhostAffluence).values(
      bothHalves(
        Array.from({ length: 7 }, (_, i) => ({
          screenhostId: venue,
          dayOfWeek: i + 1,
          hour: 10,
          estimatedImpressions: 80,
          source: 'backup' as const,
        })),
      ),
    );

    const data = await assembleReportData(venue, RANGE, TODAY);
    expect(data?.hostHasData).toBe(true);
    expect(data?.kpis.global).toBe(4800); // 30 June days × 80 × 2 halves — never zero because silent
    expect(data?.kpis.perDay).toBe(160); // FLOW-1: the grid hour fills both halves and they sum
    expect(data?.kpis.measuredDays).toBe(0);
    expect(data?.kpis.estimatedPct).toBe(100);
    // MEJ-R1 — « Pic d'audience » is a MEASURED day or nothing: an all-estimated période has no
    // peak, and the PDF tile renders « — » rather than naming an invented best day.
    expect(data?.kpis.peak).toBeNull();
    expect(data?.heatEmpty).toBe(false);
  });

  // MEJ-2 / ruling MEJ-R1 — the PDF twin runs the SAME floor as the page's /audience read.
  it('MEJ-R1: the PDF S01 never credits a venue for days before it was onboarded', async () => {
    const owner = await seedUser();
    // Onboarded mid-range (15 June) — the first half of the période predates the venue.
    const venue = await seedScreenhost(owner, {
      name: 'Café Nouveau',
      openingHour: 8,
      closingHour: 22,
      createdAt: new Date('2026-06-15T09:00:00Z'),
    });
    await db.insert(screenhostAffluence).values(
      bothHalves(
        Array.from({ length: 7 }, (_, i) => ({
          screenhostId: venue,
          dayOfWeek: i + 1,
          hour: 10,
          estimatedImpressions: 80,
          source: 'backup' as const,
        })),
      ),
    );

    const data = await assembleReportData(venue, RANGE, TODAY);
    // 15→30 June inclusive = 16 days × 160, instead of the 30 an unfloored grid would claim. The
    // FLOOR is what this pins; FLOW-1 only changes what one day is worth (80 per half, summed).
    expect(data?.kpis.global).toBe(16 * 160);
    expect(data?.kpis.perDay).toBe(160);
    expect(data?.kpis.measuredDays).toBe(0);
    expect(data?.kpis.peak).toBeNull();
  });

  it('AUD-HOURLY1-C: the PDF S02 is the période aggregated, and matches the page', async () => {
    const owner = await seedUser();
    const venue = await seedScreenhost(owner, { openingHour: 8, closingHour: 22 });
    await db.insert(screenhostAffluence).values(
      bothHalves([
        {
          screenhostId: venue,
          dayOfWeek: 1,
          hour: 12,
          estimatedImpressions: 80,
          source: 'measured',
        },
        {
          screenhostId: venue,
          dayOfWeek: 6,
          hour: 18,
          estimatedImpressions: 120,
          source: 'backup',
        },
      ]),
    );

    // 2026-06-01 (Mon) .. 2026-06-02 (Tue): only Monday is in the période.
    const data = await assembleReportData(venue, { from: '2026-06-01', to: '2026-06-02' }, TODAY);
    // Filled from the grid → an estimation, since no hourly cell backs it.
    expect(data?.heatKinds[0]?.[8]).toBe('backup'); // Mon 12h → col 4
    expect(data?.heatLevels[0]?.[8]).toBeGreaterThan(0);
    expect(data?.heatKinds[5]?.[20]).toBe('none'); // Saturday is not in the période
    expect(data?.heatLevels[5]?.[20]).toBe(0);

    const weekend = await assembleReportData(
      venue,
      { from: '2026-06-06', to: '2026-06-07' }, // Sat–Sun
      TODAY,
    );
    expect(weekend?.heatKinds[5]?.[20]).toBe('backup'); // Saturday IS in this période
    expect(weekend?.heatKinds[0]?.[8]).toBe('none'); // Monday is not
  });

  // MEJ-R2 (architect 2026-09-01) — the PDF's peak follows the same rule as the page: the highest
  // MERGED day among the days holding ≥1 measured cell. Under MEJ-R1 the mixed day below was
  // skipped whole and the smaller all-measured day was named instead.
  it('MEJ-R2: a MIXED day outranks a smaller all-measured day in the PDF peak', async () => {
    const owner = await seedUser();
    const venue = await seedScreenhost(owner, { openingHour: 8, closingHour: 22 });
    // A Monday-12h grid cell: it stands in on 01/06 (a Monday), making that day MIXED.
    await db.insert(screenhostAffluence).values(
      bothHalves([
        {
          screenhostId: venue,
          dayOfWeek: 1,
          hour: 12,
          estimatedImpressions: 80,
          source: 'backup',
        },
      ]),
    );
    await db.insert(screenhostAffluenceHourly).values(
      bothHalves([
        { screenhostId: venue, date: '2026-06-01', hour: 13, value: 300 }, // Monday, measured
        { screenhostId: venue, date: '2026-06-02', hour: 13, value: 50 }, // Tuesday, all-measured
      ]),
    );

    const data = await assembleReportData(venue, { from: '2026-06-01', to: '2026-06-02' }, TODAY);
    // 01/06 = (300 + 300) measured + (80 + 80) forced from the grid = 760, and it holds a
    // measurement. What this pins is the ORDERING — the mixed day still outranks the smaller
    // all-measured Tuesday (50 + 50 = 100) — and FLOW-1 scales both sides alike, so MEJ-R2 holds
    // for the same reason it did before.
    expect(data?.kpis.peak).toEqual({ value: 760, date: '2026-06-01' });
    expect(data?.kpis.global).toBe(860); // 760 + 100 — the tile can never exceed « Audience globale »
  });

  it('AUD-HOURLY1-C: a MEASURED hourly cell reaches the PDF S02 as measured', async () => {
    const owner = await seedUser();
    const venue = await seedScreenhost(owner, { openingHour: 8, closingHour: 22 });
    await db.insert(screenhostAffluence).values(
      bothHalves([
        {
          screenhostId: venue,
          dayOfWeek: 1,
          hour: 12,
          estimatedImpressions: 80,
          source: 'backup',
        },
      ]),
    );
    await db.insert(screenhostAffluenceHourly).values(
      bothHalves([
        { screenhostId: venue, date: '2026-06-01', hour: 12, value: 44 }, // a Monday
      ]),
    );

    const data = await assembleReportData(venue, { from: '2026-06-01', to: '2026-06-01' }, TODAY);
    expect(data?.heatKinds[0]?.[8]).toBe('measured');
    // The MEASURE wins over the grid — that is what this pins, and it is untouched. FLOW-1 only
    // changes the figure: 44 in each half sums to 88 (the grid would have given 80 × 2 = 160).
    expect(data?.kpis.global).toBe(88);
    expect(data?.kpis.measuredDays).toBe(1);
  });
});

// MEJ-14b / SPS-D1 (Mejri, ruled through the operator 2026-09-01) — the PDF's S08 and Piste 03
// read THIS block, so the document follows the same predicate as the page. A hidden score on the
// page paired with « votre score est de 90/100 » in the piste would be worse than today.
describe('assembleReportData — the S08 SPS block follows the computability predicate (MEJ-14b)', () => {
  it('a no-history venue assembles sps: null, so S08 and Piste 03 both wait', async () => {
    const owner = await seedUser();
    const venue = await seedScreenhost(owner);
    const data = await assembleReportData(venue, RANGE, TODAY);
    expect(data).not.toBeNull();
    // Not 90, not 0 — absent. « À venir » is what the template renders from a null block.
    expect(data?.sps).toBeNull();
  });

  it('one real observation and the block is assembled in full — the pin is not vacuous', async () => {
    const owner = await seedUser();
    const venue = await seedScreenhost(owner);
    // An inspection: history on the respect variable, dated well into the past so it cannot also
    // land in the Piste 01 upcoming-events teaser. The 90 d window reads the ATTESTATION's date.
    const [ev] = await db
      .insert(events)
      .values({
        name: 'Match archivé',
        kickoffAt: new Date(Date.now() - 200 * 24 * 60 * 60 * 1000),
        endsAt: new Date(Date.now() - 200 * 24 * 60 * 60 * 1000 + 60 * 60 * 1000),
      })
      .returning();
    await db
      .insert(eventAttestations)
      .values({ eventId: ev?.id ?? '', screenhostId: venue, authorId: owner, respecte: true });

    const data = await assembleReportData(venue, RANGE, TODAY);
    expect(data?.sps).not.toBeNull();
    // The SCORE IS UNCHANGED by the ruling — 90 stays 90 once it is measured.
    expect(data?.sps?.score).toBe(90);
    expect(data?.sps?.criteria.map((c) => c.key)).toEqual([
      'acceptation',
      'respect_evenements',
      'activite',
      'remplissage',
    ]);
  });
});

describe('heatmapLevels / heatmapKinds', () => {
  // Slice C — the grids are 7×48 (SLOT-indexed) and the builders return 28 columns: the 14-hour
  // window, two halves each. Column c therefore covers hour 8 + floor(c / 2).
  const measuredAll = Array.from({ length: 7 }, () =>
    Array.from({ length: 48 }, () => 'measured' as const),
  );
  const emptyGrid = (): number[][] =>
    Array.from({ length: 7 }, () => Array.from({ length: 48 }, () => 0));
  const emptySources = (): ('measured' | 'backup' | null)[][] =>
    Array.from({ length: 7 }, () => Array.from({ length: 48 }, () => null));

  it('closed hours are level 0 regardless of value; null hours mean nothing is closed', () => {
    const grid = Array.from({ length: 7 }, () => Array.from({ length: 48 }, () => 10));
    const withHours = heatmapLevels(grid, measuredAll, 9, 20);
    expect(withHours[0]?.[0]).toBe(0); // 8h00 < opening 9h → closed
    expect(withHours[0]?.[1]).toBe(0); // 8h30 too — BOTH halves of a closed hour are closed
    expect(withHours[0]?.[2]).toBeGreaterThan(0); // 9h00 open
    expect(withHours[0]?.[3]).toBeGreaterThan(0); // 9h30 open
    expect(withHours[0]?.[24]).toBe(0); // 20h00 ≥ closing → closed
    const noHours = heatmapLevels(grid, measuredAll, null, null);
    expect(noHours.flat().every((lvl) => lvl > 0)).toBe(true);
    expect(noHours[0]).toHaveLength(28);
  });

  it('a backup cell keeps its ramp level (same scale) and is flagged by heatmapKinds', () => {
    const grid = emptyGrid();
    const sources = emptySources();
    grid[0]![18] = 10; // 9h00
    sources[0]![18] = 'measured';
    grid[0]![20] = 10; // 10h00
    sources[0]![20] = 'backup';
    const levels = heatmapLevels(grid, sources, null, null);
    const kinds = heatmapKinds(grid, sources, null, null);
    expect(levels[0]?.[2]).toBe(levels[0]?.[4]); // 9h00 and 10h00: same value → same level
    expect(kinds[0]?.[2]).toBe('measured');
    expect(kinds[0]?.[4]).toBe('backup');
    expect(kinds[0]?.[6]).toBe('none'); // 11h00 — nothing there
    expect(kinds).toHaveLength(7);
    expect(kinds[0]).toHaveLength(28);
  });

  it('a measured ZERO is level 1 (a measurement), a provenance-less zero is level 0 (no data)', () => {
    const grid = emptyGrid();
    const sources = emptySources();
    grid[0]![18] = 8; // 9h00
    sources[0]![18] = 'measured';
    sources[0]![20] = 'measured'; // 10h00 — a measured 0
    const levels = heatmapLevels(grid, sources, null, null);
    expect(levels[0]?.[2]).toBe(5);
    expect(levels[0]?.[4]).toBe(1);
    expect(levels[0]?.[6]).toBe(0);
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

// ── MEJ-9 (2026-09-01) — the row and the PDF cannot disagree ──────────────────────────────────
//
// REPRODUCTION FIRST (the ticket named two candidates; only one is real):
//  (a) « the stored row's audience counter is computed measured-only » — FALSE. There IS no stored
//      counter: `screenhost_monthly_reports` holds (screenhost_id, month, storage_key,
//      generated_at) and nothing else. The history row's figures are derived CLIENT-SIDE from the
//      merged /audience read (`audienceOfMonth(allTimeDays, month)`), which has been the
//      periodAudience merge since PERF-1b. The row was never measured-only.
//  (b) « the PDF is a pre-clamp artefact » — TRUE, and it is the whole explanation. The July PDF
//      was rendered on 31/08 BEFORE the MEJ-2 floor reached prod (deployed 20:19 that evening), so
//      the backup grid still answered for a month in which the venue did not exist → « 5 540 pers,
//      100 % estimation ». The row, computed live after the deploy, applies the floor → 0.
//
// So no LIVE path can produce that disagreement any more; what remains is frozen artefacts, whose
// regeneration is a prod data action. These tests pin the invariant that keeps it that way: the
// month figure the PAGE derives (an all-time merge filtered to the month) and the one the PDF
// renders (a month-range merge) are the same number, because they are the same helper.
describe('MEJ-9 — the history row and the PDF read ONE merge', () => {
  const monthTotalFromAllTime = async (venueId: string, month: string): Promise<number> => {
    const merged = periodAudience(
      await loadPeriodAudienceInput({
        venueId,
        range: { from: '2020-01-01', to: TODAY },
        todayIso: TODAY,
      }),
    );
    // exactly what the page's audienceOfMonth does over the same wire
    return merged.days
      .filter((d) => d.date.startsWith(`${month}-`))
      .reduce((sum, d) => sum + d.audience, 0);
  };

  it("a month entirely before onboarding is 0 on BOTH sides (Mejri's July)", async () => {
    const owner = await seedUser();
    // Onboarded 26/08 — as her venue was. July precedes it entirely.
    const venue = await seedScreenhost(owner, {
      openingHour: 8,
      closingHour: 22,
      createdAt: new Date('2026-08-26T09:00:00Z'),
    });
    await db.insert(screenhostAffluence).values(
      bothHalves(
        Array.from({ length: 7 }, (_, i) => ({
          screenhostId: venue,
          dayOfWeek: i + 1,
          hour: 10,
          estimatedImpressions: 80,
          source: 'backup' as const,
        })),
      ),
    );

    const pdf = await assembleReportData(venue, { from: '2026-07-01', to: '2026-07-31' }, TODAY);
    expect(pdf?.kpis.global).toBe(0); // the PDF a regeneration would produce TODAY
    expect(pdf?.kpis.peak).toBeNull();
    expect(await monthTotalFromAllTime(venue, '2026-07')).toBe(0); // and the page's row
  });

  it('a month WITH data agrees to the person on both sides', async () => {
    const owner = await seedUser();
    const venue = await seedScreenhost(owner, {
      openingHour: 8,
      closingHour: 22,
      createdAt: new Date('2026-05-01T00:00:00Z'),
    });
    await db.insert(screenhostAffluence).values(
      bothHalves(
        Array.from({ length: 7 }, (_, i) => ({
          screenhostId: venue,
          dayOfWeek: i + 1,
          hour: 10,
          estimatedImpressions: 80,
          source: 'backup' as const,
        })),
      ),
    );
    await db.insert(screenhostMonthlyStats).values({
      screenhostId: venue,
      month: '2026-06',
      totalAudience: 500,
      daily: [{ date: '2026-06-15', audience: 500, source: 'measured' }],
      peakDayOfWeek: 1,
      peakHour: 10,
    });

    const pdf = await assembleReportData(venue, { from: '2026-06-01', to: '2026-06-30' }, TODAY);
    const row = await monthTotalFromAllTime(venue, '2026-06');
    expect(pdf?.kpis.global).toBeGreaterThan(0);
    expect(row).toBe(pdf?.kpis.global); // the invariant: same helper, same number
  });
});
