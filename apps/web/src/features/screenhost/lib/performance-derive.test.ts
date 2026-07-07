import { describe, expect, it } from 'vitest';

import {
  type PerformanceEarningsLine,
  audienceKpis,
  campaignStatut,
  categoryLabel,
  cumulativeSeries,
  dailyAudienceWithin,
  demographicBreakdown,
  impressionsOfMonth,
  impressionsWithin,
  intensityLevel,
  lineInPeriod,
  linesEndingInMonth,
  openHoursPerDay,
  quantileThresholds,
} from './performance-derive';

const line = (over: Partial<PerformanceEarningsLine> = {}): PerformanceEarningsLine => ({
  campaign_id: 'c1',
  campaign_name: 'Campagne',
  screenhost_id: 's1',
  screenhost_name: 'Venue',
  expected_imp: 1000,
  delivered_imp: 800,
  earnings_tnd: 80,
  reconciled_at: '2026-07-01T10:00:00.000Z',
  campaign_start: '2026-06-05',
  campaign_end: '2026-06-18',
  campaign_type: 'standard',
  campaign_status: 'active',
  ...over,
});

describe('openHoursPerDay', () => {
  it('is closing − opening, with the 14h mockup fallback on null/degenerate windows', () => {
    expect(openHoursPerDay(8, 21)).toBe(13);
    expect(openHoursPerDay(null, 21)).toBe(14);
    expect(openHoursPerDay(8, null)).toBe(14);
    expect(openHoursPerDay(21, 8)).toBe(14); // overnight semantics deferred
  });
});

describe('audienceKpis (S01)', () => {
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

describe('period filters', () => {
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

  it('impressionsWithin / impressionsOfMonth sum the right buckets', () => {
    const days = [
      { date: '2026-05-31', impressions: 10 },
      { date: '2026-06-10', impressions: 20 },
      { date: '2026-06-11', impressions: 30 },
    ];
    expect(impressionsWithin(days, range)).toBe(50);
    expect(impressionsOfMonth(days, '2026-06')).toBe(50);
    expect(impressionsOfMonth(days, '2026-05')).toBe(10);
  });

  it('lineInPeriod is an OVERLAP test, with reconciled_at as the null-date fallback', () => {
    expect(lineInPeriod(line(), range)).toBe(true); // fully inside
    expect(
      lineInPeriod(line({ campaign_start: '2026-05-01', campaign_end: '2026-06-02' }), range),
    ).toBe(true);
    expect(
      lineInPeriod(line({ campaign_start: '2026-07-01', campaign_end: '2026-07-05' }), range),
    ).toBe(false);
    // Null dates → the July reconciliation date anchors it OUT of June.
    expect(lineInPeriod(line({ campaign_start: null, campaign_end: null }), range)).toBe(false);
    expect(
      lineInPeriod(line({ campaign_start: null, campaign_end: null }), {
        from: '2026-07-01',
        to: '2026-07-31',
      }),
    ).toBe(true);
  });

  it('linesEndingInMonth keys on campaign_end (fallback reconciled_at)', () => {
    const lines = [
      line({ campaign_id: 'a', campaign_end: '2026-06-18' }),
      line({ campaign_id: 'b', campaign_end: '2026-07-02' }),
      line({ campaign_id: 'c', campaign_start: null, campaign_end: null }), // reconciled July
    ];
    expect(linesEndingInMonth(lines, '2026-06').map((l) => l.campaign_id)).toEqual(['a']);
    expect(linesEndingInMonth(lines, '2026-07').map((l) => l.campaign_id)).toEqual(['b', 'c']);
  });
});

describe('campaignStatut (date-derived per the CF-9 #1 ruling)', () => {
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

describe('cumulativeSeries (hero charts)', () => {
  it('aggregates same-date values, sorts, and runs the total', () => {
    expect(
      cumulativeSeries([
        { date: '2026-06-10', value: 100 },
        { date: '2026-06-01', value: 50 },
        { date: '2026-06-10', value: 25 },
      ]),
    ).toEqual([
      { date: '2026-06-01', cumulative: 50 },
      { date: '2026-06-10', cumulative: 175 },
    ]);
  });
  it('drops empty dates and handles empty input', () => {
    expect(cumulativeSeries([{ date: '', value: 10 }])).toEqual([]);
    expect(cumulativeSeries([])).toEqual([]);
  });
});

describe('demographicBreakdown (S04 — four real bands only)', () => {
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

describe('heatmap quantile bucketing (S02)', () => {
  it('buckets values into 5 levels over the positive values', () => {
    const values = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    const thresholds = quantileThresholds(values);
    expect(intensityLevel(0, thresholds)).toBe(1);
    expect(intensityLevel(10, thresholds)).toBe(1);
    expect(intensityLevel(35, thresholds)).toBe(2);
    expect(intensityLevel(55, thresholds)).toBe(3);
    expect(intensityLevel(75, thresholds)).toBe(4);
    expect(intensityLevel(100, thresholds)).toBe(5);
  });
  it('all-zero grid → everything at the ramp floor', () => {
    const thresholds = quantileThresholds([0, 0, 0]);
    expect(intensityLevel(0, thresholds)).toBe(1);
  });
});

describe('categoryLabel', () => {
  it('joins sector · Class, omits class when null, em dash when no sector', () => {
    expect(categoryLabel('Café', 'premium')).toBe('Café · Premium');
    expect(categoryLabel('Café', null)).toBe('Café');
    expect(categoryLabel(null, 'premium')).toBe('—');
  });
});
