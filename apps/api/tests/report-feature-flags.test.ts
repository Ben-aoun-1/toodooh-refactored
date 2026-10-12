import { describe, expect, it } from 'vitest';

import { FEATURE_FLAGS } from '../src/lib/feature-flags.js';
import { HEATMAP_SLOTS, type ReportData } from '../src/lib/report/assemble.js';
import { reportSectionNums } from '../src/lib/report/sections.js';
import { renderReportHtml } from '../src/lib/report/template.js';

// Operator 2026-10-12 (Q3 A) — the screenhost report hides what the page hides, through the SAME
// flags (lib/feature-flags.ts, twin of the web's): « Vos peak hours » and « Profil typologique »
// are not rendered and the remaining sections number 01…06 without a gap. Real flags here (the
// content suite, report-template.test.ts, renders with every flag ON).

const data = (): ReportData => ({
  venueName: 'Café Le Palmier',
  category: 'Café',
  sps: null,
  range: { from: '2026-06-01', to: '2026-06-30' },
  coverageDays: 30,
  generatedLabel: '08/07/2026',
  hostHasData: false,
  castHasData: false,
  kpis: { global: 0, perDay: null, perHour: null, peak: null, measuredDays: 0, estimatedPct: null },
  heatSlots: HEATMAP_SLOTS,
  heatLevels: Array.from({ length: 7 }, () => Array.from({ length: 14 }, () => 0)),
  heatKinds: Array.from({ length: 7 }, () => Array.from({ length: 14 }, () => 'none' as const)),
  heatValues: Array.from({ length: 7 }, () => Array.from({ length: 14 }, () => 0)),
  heatEmpty: false,
  days: [],
  breakdown: null,
  revenue: { totalLabel: '0', count: 0, rows: [] },
  campaignsBlock: { count: 0, cumulativeImpressions: 0, top3: [], rows: [] },
  upcomingEvents: null,
});

describe('the report under the display flags', () => {
  it('ships with peak hours, demographics and the CSP level OFF', () => {
    expect(FEATURE_FLAGS).toEqual({
      ownerPerfPeakHours: false,
      ownerPerfDemographics: false,
      cspLevel: false,
    });
  });

  it('numbers the visible sections without a gap', () => {
    expect(reportSectionNums()).toEqual({
      audience: 'Section 01',
      impressions: 'Section 02',
      revenue: 'Section 03',
      campaigns: 'Section 04',
      optimisation: 'Section 05',
      sps: 'Section 06',
    });
    expect(reportSectionNums({ ownerPerfPeakHours: true, ownerPerfDemographics: true }).sps).toBe(
      'Section 08',
    );
  });

  it('the PDF renders neither hidden section, and its last section is 06', () => {
    const html = renderReportHtml(data());
    expect(html).not.toContain('Vos peak hours');
    expect(html).not.toContain('Profil typologique de votre clientèle');
    const kickers = [...html.matchAll(/<span class="bullet"><\/span>(Section \d{2})<\/div>/g)].map(
      (m) => m[1],
    );
    expect(kickers).toEqual([
      'Section 01',
      'Section 02',
      'Section 03',
      'Section 04',
      'Section 05',
      'Section 06',
    ]);
    expect(html).toContain('Votre audience en chiffres');
    expect(html).toContain('Votre score de priorité');
  });
});
