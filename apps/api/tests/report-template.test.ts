import { describe, expect, it } from 'vitest';

import type { ReportData } from '../src/lib/report/assemble.js';
import {
  PISTE_01_NO_EVENTS_BODY,
  PISTE_02_WAIT_BODY,
  buildPistes,
} from '../src/lib/report/pistes.js';
import {
  HIST_MAX_ROWS,
  PEAK_HOURS_LEAD,
  REV_MAX_ROWS,
  impressionsChartSvg,
  renderReportHtml,
} from '../src/lib/report/template.js';

/** The « plusieurs matchs, cette semaine » teaser — pinned here so the PDF can't drift from it. */
const PISTE_01_TEASER_MANY_THIS_WEEK =
  "Plusieurs matchs importants sont à l'affiche cette semaine — annoncez leur diffusion à vos clients dès maintenant pour remplir votre lieu ces jours-là.";

// Snapshot-style contract tests for the R1.6 DARK document: five fixed pages reproducing the
// operator-approved mockup — palette, structure and FRENCH COPY VERBATIM — with the HOST/CAST
// empty variants underneath the new look. S07's three bodies come from lib/report/pistes.ts
// (PERF-QA2); this file pins that the document RENDERS what the generator returns, and
// report-pistes.test.ts pins the copy itself.

const baseData = (over: Partial<ReportData> = {}): ReportData => ({
  venueName: 'Café Le Palmier',
  category: 'Café · Salon de thé',
  sps: {
    score: 70,
    criteria: [
      { key: 'acceptation', label: "Taux d'acceptation des campagnes", weight: 40, value: 50 },
      {
        key: 'respect_evenements',
        label: 'Respect des événements acceptés',
        weight: 30,
        value: 100,
      },
      { key: 'activite', label: "Activité de l'écran", weight: 20, value: 100 },
      { key: 'remplissage', label: 'Taux de remplissage', weight: 10, value: 0 },
    ],
  },
  range: { from: '2026-06-01', to: '2026-06-30' },
  generatedLabel: '08/07/2026',
  hostHasData: false,
  castHasData: false,
  kpis: { global: 0, perDay: null, perHour: null, peak: null },
  heatLevels: Array.from({ length: 7 }, () => Array.from({ length: 14 }, () => 0)),
  heatKinds: Array.from({ length: 7 }, () => Array.from({ length: 14 }, () => 'none' as const)),
  heatEmpty: false,
  days: [],
  breakdown: null,
  revenue: { totalLabel: '0', count: 0, rows: [] },
  campaignsBlock: { count: 0, cumulativeImpressions: 0, top3: [], rows: [] },
  upcomingEvents: null,
  ...over,
});

const campaignRow = (i: number) => ({
  name: `Campagne ${String(i + 1).padStart(2, '0')} · Marque`,
  period: '05/06 – 18/06/2026',
  typeLabel: i % 3 === 0 ? 'Événementielle' : 'Standard',
  statut: (i % 2 === 0 ? 'En cours' : 'Passée') as 'En cours' | 'Passée',
  impressionsLabel: `${38 - i} 400`,
  revenueLabel: `${412 - 20 * i},00 TND`,
});

const fullData = (over: Partial<ReportData> = {}): ReportData =>
  baseData({
    hostHasData: true,
    castHasData: true,
    kpis: { global: 21400, perDay: 764, perHour: 76, peak: { value: 1180, date: '2026-06-14' } },
    heatLevels: Array.from({ length: 7 }, (_, day) =>
      Array.from({ length: 14 }, (_, h) => (day === 6 ? 0 : ((day + h) % 5) + 1)),
    ),
    // AFF1 — Monday 8h–10h are the admin's backup (estimation); every other open cell measured.
    heatKinds: Array.from({ length: 7 }, (_, day) =>
      Array.from({ length: 14 }, (_, h) =>
        day === 6
          ? ('none' as const)
          : day === 0 && h < 3
            ? ('backup' as const)
            : ('measured' as const),
      ),
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
      totalLabel: '1 065',
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
      rows: [campaignRow(0), campaignRow(1), campaignRow(2)],
    },
    ...over,
  });

const count = (html: string, needle: string | RegExp): number =>
  (html.match(needle instanceof RegExp ? needle : new RegExp(needle, 'g')) ?? []).length;

describe('renderReportHtml — the five-page dark document frame', () => {
  const html = renderReportHtml(baseData());

  it('lays out exactly 5 fixed pages, the first being the cover', () => {
    expect(count(html, /class="page( cover)?"/g)).toBe(5);
    expect(count(html, /class="page cover"/g)).toBe(1);
  });

  it('runs the runhead (venue · period) on pages 2–5 ONLY — never on the cover', () => {
    expect(count(html, /class="runhead"/g)).toBe(4);
    const cover = html.slice(
      html.indexOf('class="page cover"'),
      html.indexOf('<div class="page">'),
    );
    expect(cover).not.toContain('runhead');
    expect(html).toContain('Café Le Palmier · 01/06/2026 – 30/06/2026');
  });

  it('server-renders LITERAL page numbers 1–5 in the in-DOM footers (no Chromium chrome)', () => {
    for (let p = 1; p <= 5; p += 1) {
      expect(count(html, new RegExp(`page ${p} / 5`, 'g'))).toBe(1);
    }
    expect(html).not.toContain('<template id="pdf-header">');
    expect(html).not.toContain('<template id="pdf-footer">');
    expect(html).not.toContain('pageNumber');
  });

  it('every footer carries the Powered by wordmark with the app SVG mark (never a raster)', () => {
    expect(count(html, /class="footer"/g)).toBe(5);
    expect(count(html, /Powered by/g)).toBe(5);
    expect(count(html, /class="footer__mark"/g)).toBe(5);
    expect(html).not.toContain('data:image');
  });

  it('carries the dark palette and the mockup fonts; drops the unused --portage token', () => {
    expect(html).toContain('--paper:      #0D2B1F');
    expect(html).toContain('--mint:       #76E6AB');
    expect(html).toContain('family=Fraunces');
    expect(html).toContain('@page{ size:A4; margin:0; }');
    expect(html).not.toContain('--portage');
  });
});

describe('renderReportHtml — cover page', () => {
  const html = renderReportHtml(baseData());

  it('kicker, Fraunces hero venue, catégorie · classe sub-row, period, Généré le', () => {
    expect(html).toContain('Rapport de performances');
    expect(html).toContain('<div class="cover__title"><b>Café Le Palmier</b></div>');
    expect(html).toContain('<span class="cat">Café</span>');
    expect(html).toContain('<span class="cat">Salon de thé</span>');
    expect(html).toContain('<span class="cover__period">01/06/2026 – 30/06/2026</span>');
    expect(html).toContain('Généré le 08/07/2026');
  });

  it('echoes the 4-cell metastrip on the cover AND page 2 (labels appear twice)', () => {
    for (const label of ['Commerce', 'Période analysée', 'Catégorie', 'Campagnes incluses']) {
      expect(count(html, new RegExp(`<div class="lbl">${label}</div>`, 'g'))).toBe(2);
    }
    expect(count(html, /class="metastrip"/g)).toBe(2);
  });
});

describe('renderReportHtml — structure shared by both states', () => {
  const html = renderReportHtml(baseData());

  it('carries all eight numbered sections + their titles (copy verbatim)', () => {
    for (let s = 1; s <= 8; s += 1) {
      expect(html).toContain(`Section 0${s}`);
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

  it('renders the E4 S08 SPS card — ring with the REAL score, the 4 ruled criteria + weights + values', () => {
    expect(html).toContain('class="score-ring"');
    expect(html).toContain('Score actuel');
    expect(html).toContain('Classement');
    // The ruled labels + the CONFIG weights (the 25 % placeholder era is over) + the fixture's
    // real values.
    const criteria: [string, string, string][] = [
      ["Taux d'acceptation des campagnes", 'poids 40 %', '50 / 100'],
      ['Respect des événements acceptés', 'poids 30 %', '100 / 100'],
      ["Activité de l'écran", 'poids 20 %', '100 / 100'],
      ['Taux de remplissage', 'poids 10 %', '0 / 100'],
    ];
    for (const [name, weight, value] of criteria) {
      expect(html).toContain(`<span class="crit-name">${name}</span>`);
      expect(html).toContain(`<span class="crit-weight">${weight}</span>`);
      expect(html).toContain(`<span class="crit-val">${value}</span>`);
    }
    expect(html).toContain('<span class="v">70</span>'); // the weighted total in the ring
    expect(html).not.toContain('poids 25 %'); // the placeholder weight set retired
    expect(html).toContain('Comment lire votre score.');
  });

  it('a null sps block (compute hiccup) keeps the full wait-state — no number is invented', () => {
    const waitHtml = renderReportHtml(baseData({ sps: null }));
    expect(count(waitHtml, /À venir/g)).toBeGreaterThanOrEqual(6);
    expect(waitHtml).toContain("Taux d'acceptation des campagnes");
    expect(waitHtml).toContain('poids 40 %');
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
    // US-P.4 retires the mockup's JJ/MM/AAAA placeholder — it read as a real date at a glance.
    expect(html).not.toContain('JJ/MM/AAAA');
    expect(html).toContain('Aucun maximum observé sur la période.');
    expect(html).toContain('Nom de la campagne');
  });

  it("quotes the S04 fallback category when the venue has no sector ('—')", () => {
    const noSector = renderReportHtml(baseData({ category: '—' }));
    expect(noSector).toContain('Catégorie de lieu');
  });

  it('hachures the WHOLE grid — closed hours and no-data cells share the treatment', () => {
    expect(count(html, /class="heat-cell hclosed"/g)).toBe(7 * 14);
  });
});

describe('renderReportHtml — FULL variants (both flags true)', () => {
  const html = renderReportHtml(fullData());

  it('renders the statrow numbers, campaign rows, statut pills and the S03 svg', () => {
    expect(html).toContain('21 400'); // formatIntFr groups with NNBSP
    expect(html).toContain('1 180');
    expect(html).toContain('14/06/2026');
    expect(html).toContain('Ooredoo · Forfait Data');
    expect(html).toContain('diffusées');
    expect(html).toContain('412,00 TND');
    expect(html).toContain('Passée');
    // US-P.9 — the document carries the SAME three states as the page; « Active » is retired.
    expect(html).toContain('En cours');
    expect(html).not.toContain('>Active<');
    expect(html).toContain('s03-chart');
    expect(html).not.toContain('Évolution en attente du premier deal');
    expect(html).not.toContain('JJ/MM/AAAA');
  });

  it('renders a fractional moyenne/h with one comma decimal + the unit span', () => {
    const fractional = renderReportHtml(
      baseData({
        hostHasData: true,
        kpis: { global: 4, perDay: 4, perHour: 0.3, peak: { value: 4, date: '2026-06-26' } },
      }),
    );
    expect(fractional).toContain('0,3 <span class="unit">pers/h</span>');
  });

  it('maps ramp levels to h0..h4 and keeps the hachure ONLY for no-data cells (closed Sunday)', () => {
    expect(count(html, /class="heat-cell hclosed"/g)).toBe(14); // day 7 (DIM) only in the fixture
    for (const cls of ['h0', 'h1', 'h2', 'h3', 'h4']) {
      expect(html).toContain(`class="heat-cell ${cls}"`);
    }
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

  it(`caps the history table at ${HIST_MAX_ROWS} rows + a "+ N autres campagnes" summary (NO JS scaling)`, () => {
    const ten = renderReportHtml(
      fullData({
        campaignsBlock: {
          count: 10,
          cumulativeImpressions: 140300,
          top3: ['A', 'B', 'C'],
          rows: Array.from({ length: 10 }, (_, i) => campaignRow(i)),
        },
      }),
    );
    expect(count(ten, /<tr><td class="td-name">/g)).toBe(HIST_MAX_ROWS);
    expect(ten).toContain('+ 2 autres campagnes');
    expect(ten).not.toContain('transform:scale');
    const three = renderReportHtml(fullData());
    expect(count(three, /<tr><td class="td-name">/g)).toBe(3);
    expect(three).not.toContain('autres campagnes');
  });

  it(`caps the S05 detail list at ${REV_MAX_ROWS} rows with the same summary discipline`, () => {
    const ten = renderReportHtml(
      fullData({
        revenue: {
          totalLabel: '2 130',
          count: 10,
          rows: Array.from({ length: 10 }, (_, i) => ({
            name: `Campagne ${i + 1}`,
            period: '05/06 – 18/06',
            amountLabel: `${400 - i} TND`,
          })),
        },
      }),
    );
    expect(count(ten, /class="rev-row"/g)).toBe(REV_MAX_ROWS);
    expect(ten).toContain('+ 6 autres campagnes');
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

describe('renderReportHtml — S07 renders the pistes generator (PERF-QA2)', () => {
  const aiBody =
    'Mar 9h et Jeu 15h sont vos créneaux les plus faibles - proposez une offre matinale pour redynamiser ces périodes creuses.';
  // The document escapes every body (the generator now composes them from data).
  const esc = (v: string): string =>
    v.replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
    );
  const bothBranches = [
    renderReportHtml(fullData(), { aiPistes: aiBody }),
    renderReportHtml(baseData()),
  ];

  it('pins the three titles + kickers in BOTH branches (AI and generic)', () => {
    for (const html of bothBranches) {
      expect(count(html, /class="piste"/g)).toBe(3);
      expect(count(html, /class="piste-k"/g)).toBe(3);
      for (const p of ['Piste 01', 'Piste 02', 'Piste 03']) expect(html).toContain(p);
      expect(html).toContain('Anticipez les temps forts');
      expect(html).toContain('Repérez vos angles morts');
      expect(html).toContain('Résumé du SPS et recommandations');
      expect(html).toContain('Lecture personnalisée.');
    }
  });

  it('renders EXACTLY the generator bodies for the same data (page ↔ PDF, one engine)', () => {
    const data = fullData({
      upcomingEvents: { count: 3, soonestInDays: 2 },
    });
    const html = renderReportHtml(data, { aiPistes: aiBody });
    for (const piste of buildPistes({
      events: data.upcomingEvents,
      sps: data.sps,
      aiBody,
    })) {
      expect(html).toContain(
        `<div class="piste-body${piste.pending ? ' wait' : ''}">${esc(piste.body)}</div>`,
      );
    }
  });

  it('Piste 01 is EVENT-DRIVEN: the teaser fires on upcoming events, the honest variant without', () => {
    const withEvents = renderReportHtml(
      fullData({ upcomingEvents: { count: 2, soonestInDays: 1 } }),
    );
    expect(withEvents).toContain(esc(PISTE_01_TEASER_MANY_THIS_WEEK));
    const without = renderReportHtml(fullData({ upcomingEvents: null }));
    expect(without).toContain(esc(PISTE_01_NO_EVENTS_BODY));
    // The retired R3 hardcode never renders again.
    for (const html of [withEvents, without]) {
      expect(html).not.toContain('Coupe du Monde');
      expect(html).not.toContain("est à l'affiche ce mois-ci");
    }
  });

  it('Piste 03 is the SPS ANALYSIS when scored, and EXACTLY the wait copy when not', () => {
    // The AI body is present here, so Piste 02 leaves the wait state too — a scored venue with
    // an analysis renders ZERO wait cards.
    const scored = renderReportHtml(fullData(), { aiPistes: aiBody });
    expect(count(scored, /class="piste-body wait"/g)).toBe(0);
    expect(scored).toContain('Votre score de priorité est de 70/100.');
    // baseData's SPS: remplissage 0/100 × poids 10 loses 10 pts, acceptation 50/100 × poids 40
    // loses 20 → the WEIGHTED weakest is acceptation, not the lowest raw value.
    expect(scored).toContain(esc("Point faible : Taux d'acceptation des campagnes"));

    // No SPS and no AI body → BOTH Piste 02 (« À venir », US-P.10) and Piste 03 wait.
    const scoreless = renderReportHtml(fullData({ sps: null }));
    expect(count(scoreless, /class="piste-body wait"/g)).toBe(2);
    expect(scoreless).toContain(
      '<div class="piste-body wait">En attente de votre score de priorité.</div>',
    );
  });

  it('an AI body fills Piste 02 and displaces ONLY its wait state', () => {
    const html = renderReportHtml(fullData(), { aiPistes: aiBody });
    expect(html).toContain(aiBody);
    expect(html).not.toContain(`<div class="piste-body wait">${PISTE_02_WAIT_BODY}</div>`);
  });

  it('null/absent/blank aiPistes → Piste 02 is the « À venir » wait state (US-P.10)', () => {
    for (const html of [
      renderReportHtml(baseData()),
      renderReportHtml(baseData(), { aiPistes: null }),
      renderReportHtml(baseData(), { aiPistes: '   ' }),
    ]) {
      expect(html).toContain(`<div class="piste-body wait">${PISTE_02_WAIT_BODY}</div>`);
      expect(html).not.toContain('Comparez vos créneaux'); // the retired R3.1 generic prose
      expect(html).not.toContain('essayez X et Y'); // the mockup placeholder never renders again
      expect(html).not.toContain('Vous avez 2 périodes creuses');
    }
  });

  it('escapes the AI body (no raw HTML injection through the model)', () => {
    const html = renderReportHtml(baseData(), {
      aiPistes: '<img src=x> & <script>alert(1)</script>',
    });
    expect(html).not.toContain('<img src=x>');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('impressionsChartSvg (dark restyle + R3 axis frame)', () => {
  it('draws a closed mint area + line over the day values, above 4 gridlines and tick marks', () => {
    const svg = impressionsChartSvg([
      { date: '2026-06-01', impressions: 100 },
      { date: '2026-06-02', impressions: 0 },
      { date: '2026-06-03', impressions: 50 },
    ]);
    expect(svg).toContain('<svg');
    expect(svg).toContain('impGrad');
    expect(svg).toContain('stroke="#76E6AB"');
    expect(count(svg, /<line /g)).toBe(4 + 3); // 4 Y gridlines + one tick mark per day (≤7 days)
  });

  it('handles a single day without NaN coordinates', () => {
    const svg = impressionsChartSvg([{ date: '2026-06-01', impressions: 10 }]);
    expect(svg).not.toContain('NaN');
  });

  it('with NO days renders the bare axis frame (gridlines + ticks, no curve)', () => {
    const svg = impressionsChartSvg([]);
    expect(svg).toContain('class="s03-axes"');
    expect(count(svg, /<line /g)).toBe(4 + 6); // 4 gridlines + 6 evenly spread tick marks
    expect(svg).not.toContain('<path');
    expect(svg).not.toContain('NaN');
  });
});

describe('S03 labeled axes (R3 — Mejri item 4, OVERRIDES the axis-less mockup)', () => {
  const slice = (html: string, from: string, to: string): string =>
    html.slice(html.indexOf(from), html.indexOf(to, html.indexOf(from)));
  const ylabOf = (html: string): string => slice(html, 'class="chart-ylab"', 'class="chart-plot"');
  const xlabOf = (html: string): string => slice(html, 'class="chart-xlab"', 'chart-foot');

  it('data state: 4 impression-count Y labels on a nice scale + one DD/MM tick per day (short span)', () => {
    const html = renderReportHtml(fullData()); // fixture max 5 100 → nice top 6 000
    const ylab = ylabOf(html);
    expect(count(ylab, /<span /g)).toBe(4);
    for (const v of ['>0<', '>2 000<', '>4 000<', '>6 000<']) {
      expect(ylab).toContain(v);
    }
    const xlab = xlabOf(html);
    for (const d of ['>01/06<', '>02/06<', '>03/06<']) expect(xlab).toContain(d);
    expect(count(xlab, /<span /g)).toBe(3);
  });

  it('a month-long span keeps 5–7 span-aware ticks, ends included', () => {
    const html = renderReportHtml(
      fullData({
        days: Array.from({ length: 30 }, (_, i) => ({
          date: `2026-06-${String(i + 1).padStart(2, '0')}`,
          impressions: 100 + i,
        })),
      }),
    );
    const xlab = xlabOf(html);
    expect(count(xlab, /<span /g)).toBe(6);
    expect(xlab).toContain('>01/06<');
    expect(xlab).toContain('>30/06<');
  });

  it('empty state: the caption stays, the axis frame renders UNLABELED', () => {
    const html = renderReportHtml(baseData());
    expect(html).toContain('Évolution en attente du premier deal');
    expect(html).toContain('class="s03-axes"'); // axes present in the empty state too
    expect(count(ylabOf(html), /<span /g)).toBe(0); // no scale is claimed before the first deal
    expect(count(xlabOf(html), /<span /g)).toBe(0);
  });

  it('a CAST-flagged period with zero days still gets the empty frame (no NaN, no curve)', () => {
    const html = renderReportHtml(baseData({ castHasData: true }));
    expect(html).toContain('class="s03-axes"');
    expect(html).not.toContain('class="s03-chart"');
    expect(html).not.toContain('NaN');
  });
});

// PERF-QA1 R7 / AFF1 — the S02 lead: HONEST typical-week semantics WITH provenance. The
// exact-literal pin below is one half of the cross-package byte-equality contract — apps/web pins
// the SAME literal over its PEAK_HOURS_LEAD twin (lib/peak-hours.ts), so neither side can drift
// without its own test failing. Do not reword one without the other.
describe('S02 lead (AFF1 — the semaine type, with provenance)', () => {
  it('pins the exact wording (byte-equality contract with apps/web)', () => {
    expect(PEAK_HOURS_LEAD).toBe(
      "Audience moyenne de votre semaine type (moyenne glissante sur les 4 dernières semaines), croisant les jours de la semaine et les heures d'ouverture. Plus la couleur est vive, plus l'audience est élevée. Les cases pleines sont mesurées par votre capteur, les cases en pointillé sont des estimations. Les zones rayées correspondent à vos heures de fermeture ou aux créneaux sans aucune donnée.",
    );
  });

  it('the rendered document names the semaine type and BOTH provenances, never the period', () => {
    const html = renderReportHtml(baseData());
    expect(html).toContain(PEAK_HOURS_LEAD);
    expect(html).toContain('semaine type');
    // The withdrawn PERF-QA2 sentence is gone (« période analysée » itself survives in S01's copy).
    expect(html).not.toContain('sans aucune mesure sur la période');
  });
});

// AFF1 — the PDF S02 mirrors the page: backup cells keep their ramp level and carry the
// estimation treatment (`hest`), the legend names the three states, and the explanatory empty
// state replaces the grid ONLY when heatEmpty (no measured, no backup, no data).
describe('S02 provenance (AFF1 — same helper, same provenance as the page)', () => {
  it('backup cells carry hest ON TOP of their level class; measured cells do not', () => {
    const html = renderReportHtml(fullData());
    expect(count(html, /class="heat-cell h[0-4] hest"/g)).toBe(3); // Monday 8h, 9h, 10h
    expect(count(html, /class="heat-cell h[0-4]"/g)).toBe(6 * 14 - 3);
    expect(count(html, /class="heat-cell hclosed"/g)).toBe(14);
  });

  it('the legend names Mesuré (capteur) / Estimation / Fermé / aucune donnée', () => {
    const html = renderReportHtml(fullData());
    expect(html).toContain('Mesuré (capteur)');
    expect(html).toContain('Estimation');
    expect(html).toContain('Fermé / aucune donnée');
    expect(html).toContain('class="swatch h3 hest"');
  });

  it('heatEmpty renders the explanatory state INSTEAD of the grid', () => {
    const html = renderReportHtml(baseData({ heatEmpty: true }));
    expect(html).toContain("Pas encore de mesure d'audience");
    expect(html).not.toContain('class="heat-grid"');
    // The base (not-empty) document keeps its hachured grid and no empty copy.
    const notEmpty = renderReportHtml(baseData());
    expect(notEmpty).toContain('class="heat-grid"');
    expect(notEmpty).not.toContain("Pas encore de mesure d'audience");
  });
});
