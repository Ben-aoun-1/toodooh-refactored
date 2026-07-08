import { describe, expect, it } from 'vitest';

import type { ReportData } from '../src/lib/report/assemble.js';
import { impressionsChartSvg, renderReportHtml } from '../src/lib/report/template.js';

// Snapshot-style contract tests: the template must carry the page's sections and FRENCH COPY
// VERBATIM, with the HOST/CAST empty variants gated exactly like the page (Mejri ruling).

const baseData = (over: Partial<ReportData> = {}): ReportData => ({
  venueName: 'Café Le Palmier',
  category: 'Café · Salon de thé',
  range: { from: '2026-06-01', to: '2026-06-30' },
  generatedLabel: '08/07/2026',
  hostHasData: false,
  castHasData: false,
  kpis: { global: 0, perDay: null, perHour: null, peak: null },
  heatLevels: Array.from({ length: 7 }, () => Array.from({ length: 14 }, () => 0)),
  days: [],
  breakdown: null,
  revenue: { totalLabel: '0', count: 0, rows: [] },
  campaignsBlock: { count: 0, cumulativeImpressions: 0, top3: [], rows: [] },
  ...over,
});

const fullData = (): ReportData =>
  baseData({
    hostHasData: true,
    castHasData: true,
    kpis: { global: 21400, perDay: 764, perHour: 76, peak: { value: 1180, date: '2026-06-14' } },
    heatLevels: Array.from({ length: 7 }, (_, day) =>
      Array.from({ length: 14 }, (_, h) => (day === 6 ? 0 : ((day + h) % 5) + 1)),
    ),
    days: [
      { date: '2026-06-01', impressions: 4200 },
      { date: '2026-06-02', impressions: 0 },
      { date: '2026-06-03', impressions: 5100 },
    ],
    breakdown: {
      femmes: 11128,
      hommes: 10272,
      ages: [
        { key: 'age_17_30_pct', label: '17 – 30 ans', count: 7276 },
        { key: 'age_31_45_pct', label: '31 – 45 ans', count: 6206 },
        { key: 'age_46_60_pct', label: '46 – 60 ans', count: 3852 },
        { key: 'age_60_plus_pct', label: '60 ans et plus', count: 2140 },
      ],
    },
    revenue: {
      totalLabel: '1 065',
      count: 3,
      rows: [
        { name: 'Ooredoo · Forfait Data', period: '05/06 – 18/06', amountLabel: '412 TND' },
        { name: 'Délice Danone', period: '10/06 – 30/06', amountLabel: '358 TND' },
      ],
    },
    campaignsBlock: {
      count: 3,
      cumulativeImpressions: 140300,
      top3: ['Ooredoo · Forfait Data', 'Délice Danone', 'Attijari Bank · Rentrée'],
      rows: [
        {
          name: 'Ooredoo · Forfait Data',
          period: '05/06 – 18/06/2026',
          typeLabel: 'Standard',
          statut: 'Passée',
          impressionsLabel: '58 400',
          revenueLabel: '412,00 TND',
        },
        {
          name: 'Attijari Bank · Rentrée',
          period: '20/06 – 03/07/2026',
          typeLabel: 'Événementielle',
          statut: 'Active',
          impressionsLabel: '39 800',
          revenueLabel: '295,00 TND',
        },
      ],
    },
  });

describe('renderReportHtml — structure shared by both states', () => {
  const html = renderReportHtml(baseData());

  it('carries all eight numbered sections + their titles (copy verbatim)', () => {
    for (const s of [
      'Section 01',
      'Section 02',
      'Section 03',
      'Section 04',
      'Section 05',
      'Section 06',
      'Section 07',
      'Section 08',
    ]) {
      expect(html).toContain(s);
    }
    expect(html).toContain('Votre audience en chiffres');
    expect(html).toContain('Vos peak hours');
    expect(html).toContain('Évolution des impressions');
    expect(html).toContain('Profil typologique de votre clientèle');
    expect(html).toContain('Vos revenus de la période');
    expect(html).toContain('Vos campagnes');
    expect(html).toContain("Vos pistes d'optimisation futures");
    expect(html).toContain('Votre score de priorité');
  });

  it('carries the intro strip, the generic pistes verbatim, the SPS À venir variant, powered-by', () => {
    expect(html).toContain('Commerce');
    expect(html).toContain('Période analysée');
    expect(html).toContain('Catégorie');
    expect(html).toContain('Campagnes incluses');
    expect(html).toContain('Anticipez les temps forts');
    expect(html).toContain('Repérez vos angles morts');
    expect(html).toContain('Résumé du SPS et recommandations');
    expect(html).toContain('En attente de votre score de priorité.');
    expect(html).toContain('Score actuel');
    expect(html).toContain('À venir');
    expect(html).toContain('poids 25 %');
    expect(html).toContain('Powered by');
    expect(html).toContain('Généré le 08/07/2026');
  });
});

describe('renderReportHtml — EMPTY variants (both flags false)', () => {
  const html = renderReportHtml(baseData());

  it('every HOST/CAST slot shows its pending copy, the chart its placeholder', () => {
    expect(html).toContain('En attente du premier deal');
    expect(html).toContain('Évolution en attente du premier deal');
    expect(html).toContain('Vos premiers gains arrivent dès le lancement des campagnes.');
    expect(html).toContain("pour l'instant");
    expect(html).toContain('Vos écrans sont prêts à recevoir nos annonceurs.');
    expect(html).toContain('En attente du premier deal.');
    expect(html).toContain('JJ/MM/AAAA');
    expect(html).toContain('Nom de la campagne');
  });

  it("quotes the S04 fallback category when the venue has no sector ('—')", () => {
    const noSector = renderReportHtml(baseData({ category: '—' }));
    expect(noSector).toContain('Catégorie de lieu');
  });

  it('the heatmap is fully hachured (every cell level 0)', () => {
    const hachureCells = html.match(/class="hm-cell cell-h"/g) ?? [];
    expect(hachureCells.length).toBe(7 * 14);
  });
});

describe('renderReportHtml — FULL variants (both flags true)', () => {
  const html = renderReportHtml(fullData());

  it('renders real values, campaign rows, statut pills and the S03 svg', () => {
    expect(html).toContain('21 400');
    expect(html).toContain('1 180');
    expect(html).toContain('14/06/2026');
    expect(html).toContain('Ooredoo · Forfait Data');
    expect(html).toContain('diffusées');
    expect(html).toContain('412,00 TND');
    expect(html).toContain('Passée');
    expect(html).toContain('Active');
    expect(html).toContain('s03-chart');
    expect(html).not.toContain('Évolution en attente du premier deal');
    expect(html).not.toContain('JJ/MM/AAAA');
  });

  it('keeps the hachure ONLY for no-data cells (the closed Sunday)', () => {
    const hachureCells = html.match(/class="hm-cell cell-h"/g) ?? [];
    expect(hachureCells.length).toBe(14); // day 6 (Sunday) only in the fixture
  });

  it('a CAST-flagged period with zero rows shows the ratified empty copy', () => {
    const zeroRows = renderReportHtml(
      baseData({
        castHasData: true,
        revenue: { totalLabel: '0', count: 0, rows: [] },
      }),
    );
    expect(zeroRows).toContain('Aucune campagne sur la période analysée.');
  });

  it('escapes venue + campaign names (no raw HTML injection)', () => {
    const attack = renderReportHtml(
      baseData({
        venueName: '<script>alert(1)</script>',
        castHasData: true,
        revenue: {
          totalLabel: '10',
          count: 1,
          rows: [{ name: '<img src=x>', period: '01/06 – 02/06', amountLabel: '10 TND' }],
        },
      }),
    );
    expect(attack).not.toContain('<script>alert(1)</script>');
    expect(attack).not.toContain('<img src=x>');
    expect(attack).toContain('&lt;script&gt;');
  });
});

describe('impressionsChartSvg', () => {
  it('draws a closed area + line over the day values', () => {
    const svg = impressionsChartSvg([
      { date: '2026-06-01', impressions: 100 },
      { date: '2026-06-02', impressions: 0 },
      { date: '2026-06-03', impressions: 50 },
    ]);
    expect(svg).toContain('<svg');
    expect(svg).toContain('impGrad');
    expect(svg).toContain('stroke="#204B43"');
  });

  it('handles a single day without NaN coordinates', () => {
    const svg = impressionsChartSvg([{ date: '2026-06-01', impressions: 10 }]);
    expect(svg).not.toContain('NaN');
  });
});
