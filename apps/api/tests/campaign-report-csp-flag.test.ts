import { describe, expect, it } from 'vitest';

import type { AnalysisSections, ClosedCampaign } from '../src/lib/advertiser-performances.js';
import {
  buildCampaignReportHtml,
  campaignReportSectionNums,
} from '../src/lib/campaign-report-pdf.js';
import { FEATURE_FLAGS } from '../src/lib/feature-flags.js';

// Operator 2026-10-12 (B) — screencaster only: the campaign report hides « Répartition par
// catégorie de lieu », « Répartition par zone géographique » and the « niveau CSP » block, like
// the « Mes performances » page, and numbers the remaining sections 01–02.

const campaign: ClosedCampaign = {
  id: 'c1',
  name: 'Rentrée',
  nature: 'normal',
  startDate: '2026-09-01',
  endDate: '2026-09-10',
  closedAt: new Date('2026-09-11T00:00:00Z'),
  closedOn: '2026-09-11',
  budgetHt: 100,
  budgetTtc: 119,
  impressions: 5000,
  hours: 40,
  plays: 300,
  venues: 3,
};

const sections: AnalysisSections = {
  campaigns: [],
  overview: {
    campaignCount: 1,
    impressions: 5000,
    hours: 40,
    plays: 300,
    venues: 3,
    budgetHt: 100,
    budgetTtc: 119,
  },
  categories: [{ key: 'cafe', label: 'Café', value: 5000, pct: 100 }],
  csp: [{ key: 'premium', label: 'Premium', value: 5000, pct: 100 }],
  audience: null,
  zones: [],
};

describe('the campaign report under the screencaster flags', () => {
  it('numbers the visible sections without a gap', () => {
    expect(campaignReportSectionNums()).toEqual({
      overview: 'Section 01',
      audience: 'Section 02',
    });
    expect(
      campaignReportSectionNums({ screencasterPerfCategories: true, screencasterPerfZones: true })
        .zones,
    ).toBe('Section 04');
  });

  it('ships OFF: no « niveau CSP », no categories, no zones', () => {
    expect(FEATURE_FLAGS).toEqual({
      screencasterPerfCategories: false,
      screencasterPerfZones: false,
      cspLevel: false,
    });
    const html = buildCampaignReportHtml({
      campaign,
      sections,
      advertiserName: 'Marque',
      generatedAt: new Date('2026-10-12T00:00:00Z'),
    });
    expect(html).not.toContain('niveau CSP');
    expect(html).not.toContain('Premium');
    expect(html).toContain('Profil de l');
    expect(html).toContain('Audience mesurée dans les lieux');
    expect(html).not.toContain('Répartition par catégorie de lieu');
    expect(html).not.toContain('Répartition par zone géographique');
    expect(html).not.toContain('Section 03');
  });
});
