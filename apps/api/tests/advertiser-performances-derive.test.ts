import { describe, expect, it } from 'vitest';

import {
  type ClosedCampaign,
  type VenueImpressionLine,
  UNZONED_LABEL,
  audienceProfile,
  buildAnalysis,
  closedInPeriod,
  footprintSeries,
  natureOf,
  shareRows,
} from '../src/lib/advertiser-performances.js';
import {
  CAMPAIGN_REPORT_READY_TYPE,
  campaignReportReadyNotification,
} from '../src/lib/campaign-report-notification.js';
import { campaignReportFilename, htTtcLine } from '../src/lib/campaign-report-pdf.js';

// SC-P — the pure derivations behind « Mes performances » (Screencaster), pinned without a DB.

const closed = (over: Partial<ClosedCampaign> = {}): ClosedCampaign => ({
  id: 'c1',
  name: 'Alpha',
  nature: 'normal',
  startDate: '2026-01-01',
  endDate: '2026-01-10',
  closedAt: new Date('2026-01-11T09:00:00Z'),
  closedOn: '2026-01-11',
  budgetHt: 100,
  budgetTtc: 119,
  impressions: 1000,
  hours: 10,
  plays: 50,
  venues: 3,
  ...over,
});

const line = (over: Partial<VenueImpressionLine> = {}): VenueImpressionLine => ({
  campaignId: 'c1',
  screenhostId: 'v1',
  impressions: 1000,
  category: 'Café',
  venueClass: 'populaire',
  zoneId: 'z1',
  zoneName: 'Grand Tunis',
  ratios: null,
  ...over,
});

describe('natureOf — the binding discriminates, never the type string', () => {
  it('event iff event_id is set', () => {
    expect(natureOf(null)).toBe('normal');
    expect(natureOf('e1')).toBe('event');
  });
});

describe('closedInPeriod (RG-PERF-16 — membership = clôture date in the interval, inclusive)', () => {
  it('bounds are inclusive; a missing bound is open', () => {
    expect(closedInPeriod('2026-02-10', '2026-02-10', '2026-02-10')).toBe(true);
    expect(closedInPeriod('2026-02-10', '2026-02-11', null)).toBe(false);
    expect(closedInPeriod('2026-02-10', null, '2026-02-09')).toBe(false);
    expect(closedInPeriod('2026-02-10', null, null)).toBe(true);
  });
});

describe('shareRows', () => {
  it('1-decimal percentages; an empty total yields 0 % everywhere (never NaN)', () => {
    expect(
      shareRows([
        { key: 'a', label: 'A', value: 1 },
        { key: 'b', label: 'B', value: 2 },
      ]),
    ).toEqual([
      { key: 'a', label: 'A', value: 1, pct: 33.3 },
      { key: 'b', label: 'B', value: 2, pct: 66.7 },
    ]);
    expect(shareRows([{ key: 'a', label: 'A', value: 0 }])[0]?.pct).toBe(0);
  });
});

describe('audienceProfile (section 03 — impressions × the hub ratios)', () => {
  it('null without impressions; unprofiled venues kept apart, three age bands (CLS-AGE1)', () => {
    expect(audienceProfile([line({ impressions: 0 })])).toBeNull();
    const profile = audienceProfile([
      line({
        impressions: 1000,
        ratios: {
          genderFemalePct: 60,
          genderMalePct: 40,
          age17To30Pct: 50,
          age31To45Pct: 30,
          age46PlusPct: 20,
        },
      }),
      line({ screenhostId: 'v2', impressions: 500, ratios: null }),
    ]);
    expect(profile).toMatchObject({
      profiledImpressions: 1000,
      unprofiledImpressions: 500,
      unprofiledVenues: 1,
    });
    expect(profile?.sex.map((r) => [r.key, r.value, r.pct])).toEqual([
      ['femmes', 600, 60],
      ['hommes', 400, 40],
    ]);
    expect(profile?.age.map((r) => r.key)).toEqual(['age_17_30', 'age_31_45', 'age_46_plus']);
  });
});

describe('buildAnalysis (sections 01–04)', () => {
  const catalogue = [
    { id: 'z1', name: 'Grand Tunis' },
    { id: 'z2', name: 'Sfax' },
  ];

  it('Period mode sums; établissements are a simple sum (no cross-campaign dedup — normative)', () => {
    const a = closed({ id: 'c1', venues: 3, budgetHt: 100 });
    const b = closed({ id: 'c2', name: 'Beta', venues: 2, budgetHt: 50.5, impressions: 500 });
    const out = buildAnalysis(
      [a, b],
      [line({ campaignId: 'c1' }), line({ campaignId: 'c2', impressions: 500 })],
      catalogue,
    );
    expect(out.overview).toEqual({
      campaignCount: 2,
      impressions: 1500,
      hours: 20,
      plays: 100,
      venues: 5,
      budgetHt: 150.5,
      budgetTtc: 179.1,
    });
  });

  it('lists every catalogue zone (0 when uncovered) and an honest « Hors zone » line', () => {
    const out = buildAnalysis(
      [closed()],
      [
        line({ impressions: 900 }),
        line({ screenhostId: 'v2', impressions: 100, zoneId: null, zoneName: null }),
      ],
      catalogue,
    );
    expect(out.zones.map((z) => [z.label, z.value, z.pct])).toEqual([
      ['Grand Tunis', 900, 90],
      ['Sfax', 0, 0],
      [UNZONED_LABEL, 100, 10],
    ]);
  });

  it('per-campaign characteristics: top-2 categories, every CSP share (Q7 threshold is the web’s)', () => {
    const out = buildAnalysis(
      [closed()],
      [
        line({ category: 'Café', impressions: 700, venueClass: 'populaire' }),
        line({
          screenhostId: 'v2',
          category: 'Restaurants',
          impressions: 200,
          venueClass: 'moyen',
        }),
        line({
          screenhostId: 'v3',
          category: 'Pharmacie',
          impressions: 100,
          venueClass: 'premium',
        }),
      ],
      catalogue,
    );
    expect(out.campaigns[0]?.categories).toEqual(['Café', 'Restaurants']);
    expect(out.campaigns[0]?.cspShares.map((s) => [s.key, s.pct])).toEqual([
      ['populaire', 70],
      ['moyen', 20],
      ['premium', 10],
    ]);
    expect(out.csp.find((r) => r.key === 'non_renseigne')).toBeUndefined();
  });

  it('a venue without a class lands in « Non renseigné », shown only when it carries impressions', () => {
    const out = buildAnalysis([closed()], [line({ venueClass: null })], catalogue);
    expect(out.csp.map((r) => r.key)).toEqual(['populaire', 'moyen', 'premium', 'non_renseigne']);
  });
});

describe('footprintSeries (epic 5 — cumulative over the clôtures, oldest first)', () => {
  it('accumulates in clôture order regardless of input order', () => {
    const out = footprintSeries([
      closed({
        id: 'c2',
        name: 'Late',
        closedAt: new Date('2026-03-01T00:00:00Z'),
        closedOn: '2026-03-01',
        impressions: 5,
        hours: 2,
      }),
      closed({
        id: 'c1',
        name: 'Early',
        closedAt: new Date('2026-01-01T00:00:00Z'),
        closedOn: '2026-01-01',
        impressions: 3,
        hours: 1,
      }),
    ]);
    expect(out.map((p) => [p.name, p.impressionsCumulative, p.hoursCumulative])).toEqual([
      ['Early', 3, 1],
      ['Late', 8, 3],
    ]);
    expect(footprintSeries([])).toEqual([]);
  });
});

describe('the clôture notification + the report file', () => {
  it('US-2.1 copy, campaign-bound, one un-enumerated type', () => {
    expect(
      campaignReportReadyNotification({ id: 'c1', name: 'Soldes', advertiserId: 'u1' }),
    ).toMatchObject({
      userId: 'u1',
      type: CAMPAIGN_REPORT_READY_TYPE,
      title: 'Votre rapport de clôture de la campagne « Soldes » est prêt',
      campaignId: 'c1',
    });
    expect(CAMPAIGN_REPORT_READY_TYPE).toBe('campaign_report_ready');
  });

  it('RG-PERF-30 — HT with the TTC in parentheses; a slugged, dated filename', () => {
    expect(htTtcLine(1000, 1190)).toBe('1 000,00 TND HT (1 190,00 TND TTC)');
    expect(campaignReportFilename({ name: "Soldes d'Été 2026 !", closedOn: '2026-07-15' })).toBe(
      'rapport-soldes-d-ete-2026-2026-07-15.pdf',
    );
    expect(campaignReportFilename({ name: '***', closedOn: '2026-07-15' })).toBe(
      'rapport-campagne-2026-07-15.pdf',
    );
  });
});
