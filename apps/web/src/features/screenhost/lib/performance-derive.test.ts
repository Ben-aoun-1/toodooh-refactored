import { describe, expect, it } from 'vitest';

import {
  type PerformanceEarningsLine,
  audienceKpis,
  campaignStatut,
  campaignTypeLabel,
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
  audienceCumulative,
  audienceOfMonth,
  audienceTotal,
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
  it('is the clock span (wrap included, HOURS-X1), with the 14h fallback FLAGGED on null/zero-width', () => {
    expect(openHours(8, 21)).toEqual({ hours: 13, estimated: false });
    expect(openHours(null, 21)).toEqual({ hours: 14, estimated: true });
    expect(openHours(8, null)).toEqual({ hours: 14, estimated: true });
    expect(openHours(21, 8)).toEqual({ hours: 11, estimated: false }); // overnight — was the fallback
    expect(openHours(9, 9)).toEqual({ hours: 14, estimated: true });
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
      0,
    );
    expect(kpis.global).toBe(2100);
    expect(kpis.perDay).toBe(700);
    // HOUR-AVG1 — 700 ÷ (14 h × 2 half-hours): an hour is the mean of its two readings.
    expect(kpis.perHour).toBe(25);
    expect(kpis.peak).toEqual({ value: 900, date: '2026-06-02' });
    expect(kpis.measuredDays).toBe(3); // unmarked points count as measured (legacy wires)
    expect(kpis.estimatedPct).toBe(0);
  });

  it('PERF-R1 — counts provenance: measuredDays from sources, « dont N % estimés » share', () => {
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
    expect(kpis.global).toBe(860); // estimated days COUNT (supersedes US-P.5 measured-only)
    expect(kpis.measuredDays).toBe(1);
    expect(kpis.estimatedPct).toBe(67);
  });

  it('perHour keeps one decimal instead of rounding to a misleading 0 (Mejri prod-test #3)', () => {
    const kpis = audienceKpis([{ date: '2026-06-26', audience: 4 }], 14, 0);
    expect(kpis.perDay).toBe(4);
    expect(kpis.perHour).toBe(0.1); // 4 ÷ (14 × 2) = 0,142… → one decimal, not 0
  });

  it('R9 — divides FIRST, rounds ONCE: perHour never rides an already-rounded perDay', () => {
    // 5 pers over 2 days = 2.5/day raw; 4 open hours = 8 half-hours (HOUR-AVG1). Honest:
    // 2.5 ÷ 8 = 0.3125 → 0,3. Round-then-divide would read 3 ÷ 8 = 0.375 → 0,4 — a phantom
    // +0,1 pers/h from display rounding.
    const kpis = audienceKpis(
      [
        { date: '2026-06-01', audience: 2 },
        { date: '2026-06-02', audience: 3 },
      ],
      4,
      0,
    );
    expect(kpis.perDay).toBe(3); // display rounding still applies to the day figure
    expect(kpis.perHour).toBe(0.3); // 2.5 ÷ 8, NEVER 3 ÷ 8
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

describe('campaignStatut (US-P.9 — three date-derived states)', () => {
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

describe('demographicBreakdown (S04 — three real bands since CLS-AGE1)', () => {
  it('scales ratios to person counts against the period audience', () => {
    // CLS-AGE1 — the same class as before, with 18 % + 10 % merged into one 28 % band. The two
    // surviving counts are UNCHANGED, which is what « summed, not recomputed » has to mean.
    const breakdown = demographicBreakdown(
      {
        gender_male_pct: 48,
        gender_female_pct: 52,
        age_17_30_pct: 34,
        age_31_45_pct: 29,
        age_46_plus_pct: 28,
      },
      21400,
    );
    expect(breakdown.femmes).toBe(11128);
    expect(breakdown.hommes).toBe(10272);
    expect(breakdown.ages.map((b) => b.label)).toEqual([
      '17 – 30 ans',
      '31 – 45 ans',
      '46 ans et plus',
    ]);
    expect(breakdown.ages[0]?.count).toBe(7276);
    // 28 % of 21 400 = 5 992 — exactly the old 18 % (3 852) + 10 % (2 140).
    expect(breakdown.ages[2]?.count).toBe(5992);
    expect(breakdown.ages[2]?.count).toBe(3852 + 2140);
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

  // UI-1 — the label is DISPLAY-mapped inside categoryLabel, so the performance page header and
  // the PDF header cannot disagree for the same venue. The stored name is what arrived here.
  it('renders the display name for the two renamed sectors', () => {
    expect(categoryLabel('Resto', 'premium')).toBe('Restaurants · Premium');
    expect(categoryLabel('Resto/Bar', 'moyen')).toBe('Lounges/Bars · Moyen');
    expect(categoryLabel('Resto', null)).toBe('Restaurants');
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

describe('campaignTypeLabel (US-P.9)', () => {
  it('event positionings read « Événement », everything else is capitalised', () => {
    expect(campaignTypeLabel('event')).toBe('Événement');
    expect(campaignTypeLabel('standard')).toBe('Standard');
    expect(campaignTypeLabel('')).toBe('—');
  });
});

// PERF-1b (Mejri 31/08 pt 4) — « Votre progression depuis le début » showed the right value on the
// WRONG date: the hero plotted monthly_stats keyed by MONTH, so every point landed at `${month}-01`
// and a measurement taken today read « 01/08/2026 ». The curve now plots the day-level series
// periodAudience already builds — same helper as S01, same MEJ-2 floor, no new wire.
describe('audienceCumulative — one point per REAL day, never the month boundary', () => {
  it('a venue whose only measurement is today plots TODAY on the last point', () => {
    const series = audienceCumulative([{ date: '2026-08-31', audience: 42, source: 'measured' }]);
    expect(series).toEqual([{ date: '2026-08-31', cumulative: 42 }]);
    expect(series.at(-1)?.date).not.toBe('2026-08-01'); // the defect, stated as a guard
  });

  it('accumulates in date order, each point carrying its own day', () => {
    expect(
      audienceCumulative([
        { date: '2026-08-30', audience: 10, source: 'estimated' },
        { date: '2026-08-29', audience: 5, source: 'measured' },
        { date: '2026-08-31', audience: 7, source: 'measured' },
      ]),
    ).toEqual([
      { date: '2026-08-29', cumulative: 5 },
      { date: '2026-08-30', cumulative: 15 },
      { date: '2026-08-31', cumulative: 22 },
    ]);
  });

  it('no day is ever collapsed onto the 1st of its month', () => {
    const dates = audienceCumulative([
      { date: '2026-07-14', audience: 1 },
      { date: '2026-08-31', audience: 1 },
    ]).map((p) => p.date);
    expect(dates).toEqual(['2026-07-14', '2026-08-31']);
    expect(dates.some((d) => d.endsWith('-01'))).toBe(false);
  });

  it('an empty series is an empty curve (the hero keeps its wait-state)', () => {
    expect(audienceCumulative([])).toEqual([]);
  });
});

describe('audienceTotal / audienceOfMonth — the hero and S01 cannot disagree', () => {
  const points = [
    { date: '2026-07-31', audience: 100, source: 'measured' as const },
    { date: '2026-08-30', audience: 80, source: 'estimated' as const },
    { date: '2026-08-31', audience: 42, source: 'measured' as const },
  ];

  it('the hero total IS the S01 global for the same points', () => {
    expect(audienceTotal(points)).toBe(222);
    expect(audienceTotal(points)).toBe(audienceKpis(points, 14, 0).global);
  });

  it('a month is summed from the day series, not from a monthly row', () => {
    expect(audienceOfMonth(points, '2026-08')).toBe(122); // 80 estimated + 42 measured
    expect(audienceOfMonth(points, '2026-07')).toBe(100);
    expect(audienceOfMonth(points, '2026-09')).toBe(0);
  });

  it('the month prefix is exact — 2026-08 never catches 2026-08x or 2026-0', () => {
    expect(audienceOfMonth([{ date: '2026-08-01', audience: 9 }], '2026-0')).toBe(0);
  });

  it('empty input totals 0, not null', () => {
    expect(audienceTotal([])).toBe(0);
    expect(audienceOfMonth([], '2026-08')).toBe(0);
  });
});
