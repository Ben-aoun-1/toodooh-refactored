import { describe, expect, it } from 'vitest';

import type { AnalysisSections, ClosedCampaign } from '../src/lib/advertiser-performances.js';
import { buildCampaignReportHtml } from '../src/lib/campaign-report-pdf.js';
import { FEATURE_FLAGS } from '../src/lib/feature-flags.js';

// Flag cspLevel (operator 2026-10-12, Q2 both + Q3 A) — off: the screencaster's campaign report
// prints no « niveau CSP » block, like the « Mes performances » page.

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

describe('the campaign report under the cspLevel flag', () => {
  it('ships OFF and prints no « niveau CSP » block', () => {
    expect(FEATURE_FLAGS.cspLevel).toBe(false);
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
  });
});
