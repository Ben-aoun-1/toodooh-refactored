import { describe, expect, it } from 'vitest';

import {
  type ReportEarningsLine,
  audienceKpis,
  campaignStatut,
  categoryLabel,
  dailyAudienceWithin,
  demographicBreakdown,
  formatCompactPeriod,
  formatDateFr,
  formatIntFr,
  formatTablePeriod,
  formatTndCellFr,
  hasCastData,
  hasHostData,
  intensityLevel,
  lineInPeriod,
  openHoursPerDay,
  quantileThresholds,
  zeroFillDays,
} from '../src/lib/report/derive.js';

// PARITY PINNED — these fixtures MIRROR apps/web/src/features/screenhost/lib/
// performance-derive.test.ts (same inputs, same expectations). If a case here diverges from the
// web suite, one of the two mirrors drifted: fix the code, not the fixture. (A shared package is
// the later refactor; the divergence risk is accepted and noted in the R1 CF-9.)

const line = (over: Partial<ReportEarningsLine> = {}): ReportEarningsLine => ({
  campaign_name: 'Campagne',
  delivered_imp: 800,
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

describe('campaignStatut (web parity, date-derived)', () => {
  const today = '2026-07-07';
  it('campaign_end before today → Passée; today or later → Active', () => {
    expect(campaignStatut(line({ campaign_end: '2026-06-18' }), today)).toBe('Passée');
    expect(campaignStatut(line({ campaign_end: '2026-07-07' }), today)).toBe('Active');
    expect(campaignStatut(line({ campaign_end: '2026-08-01' }), today)).toBe('Active');
  });
  it('no end date → campaign_status is the secondary signal', () => {
    expect(campaignStatut(line({ campaign_end: null, campaign_status: 'active' }), today)).toBe(
      'Active',
    );
    expect(campaignStatut(line({ campaign_end: null, campaign_status: 'rejected' }), today)).toBe(
      'Passée',
    );
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

describe('heatmap quantile bucketing (web parity, S02)', () => {
  it('buckets values into 5 levels over the positive values; 0 = NO DATA (level 0, hachure)', () => {
    const values = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    const thresholds = quantileThresholds(values);
    expect(intensityLevel(0, thresholds)).toBe(0);
    expect(intensityLevel(10, thresholds)).toBe(1);
    expect(intensityLevel(35, thresholds)).toBe(2);
    expect(intensityLevel(55, thresholds)).toBe(3);
    expect(intensityLevel(75, thresholds)).toBe(4);
    expect(intensityLevel(100, thresholds)).toBe(5);
  });
  it('all-zero grid → every cell is no-data (hachure), never the ramp floor', () => {
    const thresholds = quantileThresholds([0, 0, 0]);
    expect(intensityLevel(0, thresholds)).toBe(0);
  });
  it('a positive cell with a degenerate distribution still ramps at the floor', () => {
    const thresholds = quantileThresholds([0, 0, 0]);
    expect(intensityLevel(5, thresholds)).toBe(1);
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
