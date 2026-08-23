import { describe, expect, it } from 'vitest';

import {
  type PerformanceEarningsLine,
  audienceKpis,
  campaignStatut,
  categoryLabel,
  cumulativeSeries,
  dailyAudienceWithin,
  demographicBreakdown,
  formatDecimalFr,
  hasCastData,
  hasHostData,
  impressionsOfMonth,
  impressionsWithin,
  lineInPeriod,
  linesEndingInMonth,
  openHours,
  venueReadsState,
  zeroFillDays,
} from './performance-derive';

const line = (over: Partial<PerformanceEarningsLine> = {}): PerformanceEarningsLine => ({
  campaign_id: 'c1',
  campaign_name: 'Campagne',
  screenhost_id: 's1',
  screenhost_name: 'Venue',
  expected_imp: 1000,
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

describe('openHours (R9)', () => {
  it('is closing − opening, with the 14h fallback FLAGGED on null/degenerate windows', () => {
    expect(openHours(8, 21)).toEqual({ hours: 13, estimated: false });
    expect(openHours(null, 21)).toEqual({ hours: 14, estimated: true });
    expect(openHours(8, null)).toEqual({ hours: 14, estimated: true });
    expect(openHours(21, 8)).toEqual({ hours: 14, estimated: true }); // overnight deferred
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
    expect(kpis.measuredDays).toBe(3);
  });

  it('perHour keeps one decimal instead of rounding to a misleading 0 (Mejri prod-test #3)', () => {
    const kpis = audienceKpis([{ date: '2026-06-26', audience: 4 }], 14);
    expect(kpis.perDay).toBe(4);
    expect(kpis.perHour).toBe(0.3); // 4 ÷ 14 = 0,2857… → one decimal, not 0
  });

  it('R9 — divides FIRST, rounds ONCE: perHour never rides an already-rounded perDay', () => {
    // 5 pers over 2 days = 2.5/day raw; 4 open hours. Honest: 2.5 ÷ 4 = 0.625 → 0,6. The old
    // round-then-divide read 3 ÷ 4 = 0.75 → 0,8 — a phantom +0,2 pers/h from display rounding.
    const kpis = audienceKpis(
      [
        { date: '2026-06-01', audience: 2 },
        { date: '2026-06-02', audience: 3 },
      ],
      4,
    );
    expect(kpis.perDay).toBe(3); // display rounding still applies to the day figure
    expect(kpis.perHour).toBe(0.6); // 2.5 ÷ 4, NEVER 3 ÷ 4
  });

  it('empty input → the honest empty state', () => {
    expect(audienceKpis([], 14)).toEqual({
      global: 0,
      perDay: null,
      perHour: null,
      peak: null,
      measuredDays: 0,
    });
  });
});

describe('formatDecimalFr (the moyenne/h display)', () => {
  it('renders at most one comma decimal; whole numbers drop it', () => {
    expect(formatDecimalFr(0.3)).toBe('0,3');
    expect(formatDecimalFr(0.2857)).toBe('0,3');
    expect(formatDecimalFr(4)).toBe('4');
    expect(formatDecimalFr(54.6)).toBe('54,6');
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

describe('HOST/CAST first-data flags (Mejri ruling)', () => {
  const zeroGrid = Array.from({ length: 7 }, () => Array<number>(24).fill(0));

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

describe('zeroFillDays (S03 after the first CAST data)', () => {
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

describe('categoryLabel', () => {
  it('joins sector · Class, omits class when null, em dash when no sector', () => {
    expect(categoryLabel('Café', 'premium')).toBe('Café · Premium');
    expect(categoryLabel('Café', null)).toBe('Café');
    expect(categoryLabel(null, 'premium')).toBe('—');
  });
});

describe('zeroFillDays — the R8 pin (her 26/06 case)', () => {
  it('a lone measured day renders ON the zero-filled curve, zeros around it', () => {
    expect(
      zeroFillDays([{ date: '2026-06-26', impressions: 4 }], {
        from: '2026-06-24',
        to: '2026-06-28',
      }),
    ).toEqual([
      { date: '2026-06-24', impressions: 0 },
      { date: '2026-06-25', impressions: 0 },
      { date: '2026-06-26', impressions: 4 },
      { date: '2026-06-27', impressions: 0 },
      { date: '2026-06-28', impressions: 0 },
    ]);
  });
});

describe('venueReadsState — the INV-1 surface gate', () => {
  const ok = { pending: false, error: false };

  it('ready only when EVERY read settled successfully', () => {
    expect(venueReadsState([ok, ok, ok])).toBe('ready');
    expect(venueReadsState([])).toBe('ready');
  });

  it('any pending read gates the surfaces behind the loader — never pre-first-data copy', () => {
    expect(venueReadsState([ok, { pending: true, error: false }, ok])).toBe('loading');
  });

  it('any failed read is an ERROR state — never pre-first-data copy (the 2026-08-07 incident)', () => {
    expect(venueReadsState([ok, ok, { pending: false, error: true }])).toBe('error');
  });

  it('error outranks loading so the retry affordance is never hidden behind a spinner', () => {
    expect(
      venueReadsState([
        { pending: true, error: false },
        { pending: false, error: true },
      ]),
    ).toBe('error');
  });
});
