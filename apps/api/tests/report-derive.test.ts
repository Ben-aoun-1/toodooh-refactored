import { describe, expect, it } from 'vitest';

import {
  type ReportEarningsLine,
  audienceKpis,
  campaignStatut,
  campaignTypeLabel,
  categoryLabel,
  dailyAudienceWithin,
  demographicBreakdown,
  formatCompactPeriod,
  formatDateFr,
  formatDecimalFr,
  formatIntFr,
  formatTablePeriod,
  formatTndCellFr,
  hasCastData,
  hasHostData,
  lineInPeriod,
  heatmapLevel,
  heatmapScale,
  openHoursPerDay,
  zeroFillDays,
} from '../src/lib/report/derive.js';

// PARITY PINNED — these fixtures MIRROR apps/web/src/features/screenhost/lib/
// performance-derive.test.ts (same inputs, same expectations). If a case here diverges from the
// web suite, one of the two mirrors drifted: fix the code, not the fixture. (A shared package is
// the later refactor; the divergence risk is accepted and noted in the R1 CF-9.)

const line = (over: Partial<ReportEarningsLine> = {}): ReportEarningsLine => ({
  campaign_name: 'Campagne',
  delivered_imp: 800,
  display_imp: 800, // NET-IMP1 — settled rows: affichées = delivered (reconcile's identity)
  earnings_tnd: 80,
  reconciled_at: '2026-07-01T10:00:00.000Z',
  campaign_start: '2026-06-05',
  campaign_end: '2026-06-18',
  campaign_type: 'standard',
  campaign_status: 'active',
  ...over,
});

describe('openHoursPerDay (web parity)', () => {
  it('is closing − opening, with the 14h mockup fallback on null/degenerate windows', () => {
    expect(openHoursPerDay(8, 21)).toBe(13);
    expect(openHoursPerDay(null, 21)).toBe(14);
    expect(openHoursPerDay(8, null)).toBe(14);
    expect(openHoursPerDay(21, 8)).toBe(14);
  });
});

describe('audienceKpis (web parity, S01)', () => {
  it('sums, averages over days WITH data, derives per-hour, finds the peak', () => {
    const kpis = audienceKpis(
      [
        { date: '2026-06-01', audience: 700 },
        { date: '2026-06-02', audience: 900 },
        { date: '2026-06-03', audience: 500 },
      ],
      14,
      0,
    );
    expect(kpis.global).toBe(2100);
    expect(kpis.perDay).toBe(700);
    expect(kpis.perHour).toBe(50);
    expect(kpis.peak).toEqual({ value: 900, date: '2026-06-02' });
    expect(kpis.measuredDays).toBe(3); // unmarked points count as measured (legacy wires)
    expect(kpis.estimatedPct).toBe(0);
  });

  it('PERF-R1 (web parity) — provenance counting: measuredDays + « dont N % estimés »', () => {
    const kpis = audienceKpis(
      [
        { date: '2026-06-01', audience: 700, source: 'measured' },
        { date: '2026-06-02', audience: 80, source: 'estimated' },
        { date: '2026-06-03', audience: 80, source: 'estimated' },
      ],
      14,
      // AUD-HOURLY1-C — the share is the MERGE's (data points: cells + day-granularity history),
      // handed in rather than re-derived from these day totals.
      67,
    );
    expect(kpis.global).toBe(860); // estimated days COUNT (PERF-R1 supersedes US-P.5)
    expect(kpis.measuredDays).toBe(1);
    expect(kpis.estimatedPct).toBe(67);
    // MEJ-R1 — the peak skips the estimated days entirely.
    expect(kpis.peak).toEqual({ value: 700, date: '2026-06-01' });
  });

  it('perHour keeps one decimal instead of rounding to a misleading 0 (Mejri prod-test #3)', () => {
    const kpis = audienceKpis([{ date: '2026-06-26', audience: 4 }], 14, 0);
    expect(kpis.perDay).toBe(4);
    expect(kpis.perHour).toBe(0.3); // 4 ÷ 14 = 0,2857… → one decimal, not 0
  });

  it('empty input → the honest empty state', () => {
    expect(audienceKpis([], 14, null)).toEqual({
      global: 0,
      perDay: null,
      perHour: null,
      peak: null,
      measuredDays: 0,
      estimatedPct: null,
    });
  });
});

// MEJ-2 / ruling MEJ-R1 (2026-08-31) — « Pic d'audience » is a MEASURED day or nothing.
describe('MEJ-R2 — the peak is the highest MERGED day among days holding a measurement', () => {
  // THE REGRESSION (Mejri, 01/09): 31/08 measured 373 people but contained ONE grid-filled hour,
  // so MEJ-R1's « every hour measured » reading skipped the whole day and the tile named the
  // 5-person 01/09 as the peak. A day with at least one measured cell is now eligible, and the
  // value is the merged day total the page already sums.
  it('a MIXED day (1 measured hour + 1 backup hour) can be the peak', () => {
    const kpis = audienceKpis(
      [
        { date: '2026-08-31', audience: 373, source: 'estimated', hasMeasured: true },
        { date: '2026-09-01', audience: 5, source: 'measured', hasMeasured: true },
      ],
      14,
      50,
    );
    expect(kpis.peak).toEqual({ value: 373, date: '2026-08-31' }); // was « 5 le 01/09 »
    expect(kpis.global).toBe(378); // and it cannot contradict « Audience globale »
  });

  it("MEJ-R1's real target survives: a grid-ONLY day is never the peak, however large", () => {
    const kpis = audienceKpis(
      [
        { date: '2026-06-01', audience: 700, source: 'measured', hasMeasured: true },
        // the phantom Monday: built entirely from the typical-week grid
        { date: '2026-06-02', audience: 1396, source: 'estimated', hasMeasured: false },
      ],
      14,
      50,
    );
    expect(kpis.global).toBe(2096); // the TOTAL still merges both (PERF-R1)
    expect(kpis.peak).toEqual({ value: 700, date: '2026-06-01' }); // the PEAK does not
  });

  it('a période with no measured cell at all has NO peak → the tile renders « — »', () => {
    const kpis = audienceKpis(
      [
        { date: '2026-06-01', audience: 80, source: 'estimated', hasMeasured: false },
        { date: '2026-06-02', audience: 1396, source: 'estimated', hasMeasured: false },
      ],
      14,
      100,
    );
    expect(kpis.peak).toBeNull();
    expect(kpis.global).toBe(1476);
  });

  it('unmarked points still count as measured (legacy wires) and can peak', () => {
    const kpis = audienceKpis([{ date: '2026-06-01', audience: 300 }], 14, 0);
    expect(kpis.peak).toEqual({ value: 300, date: '2026-06-01' });
  });

  it('hasMeasured OVERRIDES the source fallback in both directions', () => {
    // estimated + hasMeasured → eligible…
    expect(
      audienceKpis(
        [{ date: '2026-06-01', audience: 9, source: 'estimated', hasMeasured: true }],
        14,
        50,
      ).peak,
    ).toEqual({ value: 9, date: '2026-06-01' });
    // …and measured + !hasMeasured → not (belt and braces; the merge never emits this pair).
    expect(
      audienceKpis(
        [{ date: '2026-06-01', audience: 9, source: 'measured', hasMeasured: false }],
        14,
        0,
      ).peak,
    ).toBeNull();
  });
});

describe('period filtering (web parity)', () => {
  const range = { from: '2026-06-01', to: '2026-06-30' };

  it('dailyAudienceWithin flattens months and keeps only in-range days', () => {
    const months = [
      { daily: [{ date: '2026-05-31', audience: 1 }] },
      {
        daily: [
          { date: '2026-06-01', audience: 2 },
          { date: '2026-06-30', audience: 3 },
        ],
      },
    ];
    expect(dailyAudienceWithin(months, range)).toEqual([
      { date: '2026-06-01', audience: 2 },
      { date: '2026-06-30', audience: 3 },
    ]);
  });

  it('lineInPeriod is an OVERLAP test, with reconciled_at as the null-date fallback', () => {
    expect(lineInPeriod(line(), range)).toBe(true);
    expect(
      lineInPeriod(line({ campaign_start: '2026-05-01', campaign_end: '2026-06-02' }), range),
    ).toBe(true);
    expect(
      lineInPeriod(line({ campaign_start: '2026-07-01', campaign_end: '2026-07-05' }), range),
    ).toBe(false);
    expect(lineInPeriod(line({ campaign_start: null, campaign_end: null }), range)).toBe(false);
    expect(
      lineInPeriod(line({ campaign_start: null, campaign_end: null }), {
        from: '2026-07-01',
        to: '2026-07-31',
      }),
    ).toBe(true);
  });
});

describe('campaignStatut (web parity, US-P.9 three states)', () => {
  const today = '2026-07-07';
  it('before its start → À venir; inside its window → En cours; after its end → Passée', () => {
    expect(
      campaignStatut(line({ campaign_start: '2026-07-20', campaign_end: '2026-07-30' }), today),
    ).toBe('À venir');
    expect(
      campaignStatut(line({ campaign_start: '2026-07-01', campaign_end: '2026-07-07' }), today),
    ).toBe('En cours');
    expect(
      campaignStatut(line({ campaign_start: '2026-06-01', campaign_end: '2026-06-18' }), today),
    ).toBe('Passée');
  });
  it('the day of the start and the day of the end are both INSIDE the window', () => {
    expect(campaignStatut(line({ campaign_start: today, campaign_end: '2026-08-01' }), today)).toBe(
      'En cours',
    );
    expect(campaignStatut(line({ campaign_start: '2026-06-01', campaign_end: today }), today)).toBe(
      'En cours',
    );
  });
  it('null dates fall back to the reconciliation date — never an undefined state', () => {
    // reconciled_at is 2026-07-01 in the fixture: start and end both collapse onto it.
    expect(campaignStatut(line({ campaign_start: null, campaign_end: null }), today)).toBe(
      'Passée',
    );
    expect(campaignStatut(line({ campaign_start: null, campaign_end: '2026-08-01' }), today)).toBe(
      'En cours',
    );
  });
  it('« Active » is retired — it said nothing about a campaign that had not started', () => {
    for (const statut of [
      campaignStatut(line({ campaign_start: '2026-07-20', campaign_end: '2026-07-30' }), today),
      campaignStatut(line({ campaign_start: '2026-06-01', campaign_end: '2026-06-18' }), today),
    ]) {
      expect(statut).not.toBe('Active');
    }
  });
});

describe('demographicBreakdown (web parity, S04 — four real bands only)', () => {
  it('scales ratios to person counts against the period audience', () => {
    const breakdown = demographicBreakdown(
      {
        gender_male_pct: 48,
        gender_female_pct: 52,
        age_17_30_pct: 34,
        age_31_45_pct: 29,
        age_46_60_pct: 18,
        age_60_plus_pct: 10,
      },
      21400,
    );
    expect(breakdown.femmes).toBe(11128);
    expect(breakdown.hommes).toBe(10272);
    expect(breakdown.ages.map((b) => b.label)).toEqual([
      '17 – 30 ans',
      '31 – 45 ans',
      '46 – 60 ans',
      '60 ans et plus',
    ]);
    expect(breakdown.ages[0]?.count).toBe(7276);
  });
});

describe('HOST/CAST first-data flags (web parity, Mejri ruling)', () => {
  const zeroGrid = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));

  it('hasHostData: any monthly-stats month OR any non-zero affluence cell', () => {
    expect(hasHostData([], zeroGrid)).toBe(false);
    expect(hasHostData([], [])).toBe(false);
    expect(hasHostData([{ month: '2026-06' }], zeroGrid)).toBe(true);
    const grid = zeroGrid.map((row) => [...row]);
    grid[3]![14] = 42;
    expect(hasHostData([], grid)).toBe(true);
  });

  it('hasCastData: any earnings line OR any impressions-daily day', () => {
    expect(hasCastData([], [])).toBe(false);
    expect(hasCastData([line()], [])).toBe(true);
    expect(hasCastData([], [{ date: '2026-06-01', impressions: 12 }])).toBe(true);
  });
});

describe('zeroFillDays (web parity, S03 after the first CAST data)', () => {
  it('fills every day of the range, keeping real values and zeroing the gaps', () => {
    expect(
      zeroFillDays(
        [
          { date: '2026-06-02', impressions: 20 },
          { date: '2026-06-04', impressions: 40 },
        ],
        { from: '2026-06-01', to: '2026-06-04' },
      ),
    ).toEqual([
      { date: '2026-06-01', impressions: 0 },
      { date: '2026-06-02', impressions: 20 },
      { date: '2026-06-03', impressions: 0 },
      { date: '2026-06-04', impressions: 40 },
    ]);
  });
  it('crosses month boundaries and returns [] on an inverted range', () => {
    expect(zeroFillDays([], { from: '2026-06-29', to: '2026-07-01' }).map((d) => d.date)).toEqual([
      '2026-06-29',
      '2026-06-30',
      '2026-07-01',
    ]);
    expect(zeroFillDays([], { from: '2026-07-02', to: '2026-07-01' })).toEqual([]);
  });
});

describe('categoryLabel (web parity)', () => {
  it('joins sector · Class, omits class when null, em dash when no sector', () => {
    expect(categoryLabel('Café', 'premium')).toBe('Café · Premium');
    expect(categoryLabel('Café', null)).toBe('Café');
    expect(categoryLabel(null, 'premium')).toBe('—');
  });
});

describe('fr-FR formats (deterministic, U+202F grouping — what the page renders in-browser)', () => {
  it('formatIntFr groups thousands with narrow no-break space', () => {
    expect(formatIntFr(191400)).toBe('191\u202f400');
    expect(formatIntFr(764)).toBe('764');
    expect(formatIntFr(-12345)).toBe('-12\u202f345');
  });
  it('formatDecimalFr renders at most one comma decimal; whole numbers drop it (web parity)', () => {
    expect(formatDecimalFr(0.3)).toBe('0,3');
    expect(formatDecimalFr(0.2857)).toBe('0,3');
    expect(formatDecimalFr(4)).toBe('4');
    expect(formatDecimalFr(54.6)).toBe('54,6');
  });
  it('formatTndCellFr renders comma decimals + TND', () => {
    expect(formatTndCellFr(412)).toBe('412,00 TND');
    expect(formatTndCellFr(1640.5)).toBe('1\u202f640,50 TND');
  });
  it('date formats mirror the web period lib', () => {
    expect(formatDateFr('2026-06-14')).toBe('14/06/2026');
    expect(formatDateFr('garbage')).toBe('—');
    expect(formatCompactPeriod('2026-06-05', '2026-06-18')).toBe('05/06 – 18/06');
    expect(formatTablePeriod('2026-06-05', '2026-06-18')).toBe('05/06 – 18/06/2026');
    expect(formatTablePeriod(null, null)).toBe('—');
  });
});

describe('heatmapScale / heatmapLevel (twins of the web lib)', () => {
  it('the scale is the PERIOD’s own observed min/max, ignoring unmeasured cells', () => {
    expect(heatmapScale([null, 4, null, 12])).toEqual({ min: 4, max: 12 });
    expect(heatmapScale([null, null])).toBeNull();
  });

  it('ramps 1→5 linearly between min and max', () => {
    const scale = { min: 0, max: 100 };
    expect(heatmapLevel(0, scale)).toBe(1);
    expect(heatmapLevel(20, scale)).toBe(1);
    expect(heatmapLevel(21, scale)).toBe(2);
    expect(heatmapLevel(60, scale)).toBe(3);
    expect(heatmapLevel(100, scale)).toBe(5);
  });

  it('level 0 is reserved for NO MEASURE (null value, or no scale at all)', () => {
    expect(heatmapLevel(null, { min: 0, max: 10 })).toBe(0);
    expect(heatmapLevel(5, null)).toBe(0);
  });

  it('a period whose measures are all equal reads at the neutral middle, not a peak', () => {
    expect(heatmapLevel(7, { min: 7, max: 7 })).toBe(3);
  });
});

describe('campaignTypeLabel (US-P.9)', () => {
  it('event positionings read « Événement », everything else is capitalised', () => {
    expect(campaignTypeLabel('event')).toBe('Événement');
    expect(campaignTypeLabel('standard')).toBe('Standard');
    expect(campaignTypeLabel('')).toBe('—');
  });
});
