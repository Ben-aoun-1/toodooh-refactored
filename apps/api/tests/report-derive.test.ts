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
  measuredLevel,
  measuredScale,
  openHoursPerDay,
  periodWeekGrid,
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
    );
    expect(kpis.global).toBe(2100);
    expect(kpis.perDay).toBe(700);
    expect(kpis.perHour).toBe(50);
    expect(kpis.peak).toEqual({ value: 900, date: '2026-06-02' });
  });

  it('perHour keeps one decimal instead of rounding to a misleading 0 (Mejri prod-test #3)', () => {
    const kpis = audienceKpis([{ date: '2026-06-26', audience: 4 }], 14);
    expect(kpis.perDay).toBe(4);
    expect(kpis.perHour).toBe(0.3); // 4 ÷ 14 = 0,2857… → one decimal, not 0
  });

  it('empty input → the honest empty state', () => {
    expect(audienceKpis([], 14)).toEqual({ global: 0, perDay: null, perHour: null, peak: null });
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

// ── PERF-QA2 amendment (US-P.5) — periodWeekGrid over MEASURED Ai_jh ONLY ─────────────────────
// The estimate-fed version of this grid is WITHDRAWN (ruling 2026-08-20): Pers_atteintes is a
// sensor measure, and « toute case sans aucune mesure sur la période est affichée hachurée ».
// TWIN of the other package's implementation — page and PDF apply the SAME rule to their windows.
describe('periodWeekGrid (measured)', () => {
  const JUNE = { from: '2026-06-01', to: '2026-06-30' };
  const ONE_WEEK = { from: '2026-06-01', to: '2026-06-07' }; // Monday → Sunday

  it('a ≤ 1-week filter shows the RAW Ai_jh of that week (exact, for the tooltip)', () => {
    const grid = periodWeekGrid(
      [
        { date: '2026-06-01', hour: 10, audience: 7 }, // Monday
        { date: '2026-06-07', hour: 18, audience: 43 }, // Sunday
      ],
      ONE_WEEK,
    );
    expect(grid[0]?.[10]).toBe(7);
    expect(grid[6]?.[18]).toBe(43);
  });

  it('a > 1-week filter averages each (weekday, hour) over the weeks that HAVE a measure', () => {
    const grid = periodWeekGrid(
      [
        { date: '2026-06-01', hour: 10, audience: 10 }, // Monday, week 1
        { date: '2026-06-08', hour: 10, audience: 20 }, // Monday, week 2
        { date: '2026-06-15', hour: 10, audience: 30 }, // Monday, week 3
      ],
      JUNE,
    );
    // Mean over the THREE measured occurrences — the two unmeasured Mondays of June contribute
    // nothing (counting them as 0 would invent a measurement).
    expect(grid[0]?.[10]).toBe(20);
  });

  it('a cell with NO measure is null — hachure, never a coloured 0', () => {
    const grid = periodWeekGrid([{ date: '2026-06-01', hour: 10, audience: 5 }], JUNE);
    expect(grid[0]?.[11]).toBeNull();
    expect(grid[3]?.[10]).toBeNull();
  });

  it('a MEASURED zero is a measure — it colours at the bottom of the ramp, never hachured', () => {
    const grid = periodWeekGrid(
      [
        { date: '2026-06-01', hour: 10, audience: 0 },
        { date: '2026-06-01', hour: 11, audience: 40 },
      ],
      ONE_WEEK,
    );
    expect(grid[0]?.[10]).toBe(0);
    const scale = measuredScale([grid[0]?.[10] ?? null, grid[0]?.[11] ?? null]);
    expect(measuredLevel(grid[0]?.[10] ?? null, scale)).toBe(1);
    expect(measuredLevel(null, scale)).toBe(0);
  });

  it('measures OUTSIDE the period contribute nothing', () => {
    const grid = periodWeekGrid([{ date: '2026-05-25', hour: 10, audience: 900 }], JUNE);
    expect(grid.every((row) => row.every((v) => v === null))).toBe(true);
  });

  it('an empty measured source yields an all-null grid (the estimate never fills in)', () => {
    const grid = periodWeekGrid([], JUNE);
    expect(grid).toHaveLength(7);
    expect(grid.every((row) => row.length === 24 && row.every((v) => v === null))).toBe(true);
  });

  it('maps Sunday to the LAST row (Monday-first), like the affluence grid', () => {
    const grid = periodWeekGrid([{ date: '2026-06-07', hour: 12, audience: 3 }], ONE_WEEK);
    expect(grid[6]?.[12]).toBe(3);
    expect(grid[0]?.[12]).toBeNull();
  });

  it('drops malformed dates and out-of-range hours instead of throwing', () => {
    expect(() =>
      periodWeekGrid(
        [
          { date: 'pas-une-date', hour: 10, audience: 9 },
          { date: '2026-06-01', hour: 24, audience: 9 },
          { date: '2026-06-01', hour: -1, audience: 9 },
        ],
        JUNE,
      ),
    ).not.toThrow();
    expect(
      periodWeekGrid([{ date: '2026-06-01', hour: 24, audience: 9 }], JUNE)[0]?.[0],
    ).toBeNull();
  });
});

describe('measuredScale / measuredLevel', () => {
  it('the scale is the PERIOD’s own observed min/max, ignoring unmeasured cells', () => {
    expect(measuredScale([null, 4, null, 12])).toEqual({ min: 4, max: 12 });
    expect(measuredScale([null, null])).toBeNull();
  });

  it('ramps 1→5 linearly between min and max', () => {
    const scale = { min: 0, max: 100 };
    expect(measuredLevel(0, scale)).toBe(1);
    expect(measuredLevel(20, scale)).toBe(1);
    expect(measuredLevel(21, scale)).toBe(2);
    expect(measuredLevel(60, scale)).toBe(3);
    expect(measuredLevel(100, scale)).toBe(5);
  });

  it('level 0 is reserved for NO MEASURE (null value, or no scale at all)', () => {
    expect(measuredLevel(null, { min: 0, max: 10 })).toBe(0);
    expect(measuredLevel(5, null)).toBe(0);
  });

  it('a period whose measures are all equal reads at the neutral middle, not a peak', () => {
    expect(measuredLevel(7, { min: 7, max: 7 })).toBe(3);
  });
});

describe('campaignTypeLabel (US-P.9)', () => {
  it('event positionings read « Événement », everything else is capitalised', () => {
    expect(campaignTypeLabel('event')).toBe('Événement');
    expect(campaignTypeLabel('standard')).toBe('Standard');
    expect(campaignTypeLabel('')).toBe('—');
  });
});
