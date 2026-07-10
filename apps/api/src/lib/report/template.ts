import type { ReportData } from './assemble.js';
import {
  type DailyImpressionsPoint,
  formatDateFr,
  formatDecimalFr,
  formatIntFr,
} from './derive.js';

// ONE self-contained HTML document for the R1 report — inline CSS derived from the perf page /
// mockup styles (the design HTMLs' FINAL :root overrides), Geist via the SAME Google-Fonts import
// as the web app (system-font fallback offline). Scope = the page FROM THE FILTERS DOWN: intro
// strip + S01→S08 with the page's FRENCH COPY VERBATIM, HOST/CAST empty variants identical to the
// page (Mejri ruling), SPS "À venir", the three GENERIC pistes.
//
// R1.5 document chrome: a COVER PAGE (brand mark, document title, venue, category, period,
// "Généré le") opens the document and a running header/footer prints on every page via the inert
// <template id="pdf-header|pdf-footer"> tags at the end of <body> — render.ts extracts them and
// switches Chromium's displayHeaderFooter on (call sites untouched). Chromium cannot suppress the
// chrome on the first page, so the cover keeps generous whitespace at both edges. The header and
// footer templates are sandboxed by Chromium: inline styles only, no page classes, no webfonts.

const PENDING = 'En attente du premier deal';
const CHART_PENDING = 'Évolution en attente du premier deal';
const NO_CAMPAIGN_IN_PERIOD = 'Aucune campagne sur la période analysée.';

const RAMP = ['#E4F5EC', '#BFEBD5', '#88DAB2', '#4FC28D', '#1D9E75'];
const HOUR_LABELS = Array.from({ length: 14 }, (_, i) => `${i + 8}h`);
const DAY_LABELS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

/** The EMPTY mockup's decorative S04 bar widths (sexe 50/50; the four ruled age bands). */
const PLACEHOLDER_SEXE_PCT = [50, 50];
const PLACEHOLDER_AGE_PCT = [32, 28, 14, 6];

const esc = (value: string): string =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );

/** The TOODOOH mark glyph (the app's own favicon paths), scaled by the CSS class. */
const brandMark = (cls: string): string =>
  `<svg class="${cls}" viewBox="0 0 448.65 367.85" fill="currentColor"><path d="M448.65 83.88v107.03c0 20.82-8.31 39.71-21.8 53.52l-100.98 100.98c-13.65 13.65-32.43 22.17-53.19 22.44H165.12v-83.21H315.4c11.74 0 22.5-4.24 30.81-11.3 2.8-2.37 5.32-5.06 7.51-8.01 2.93-3.97 5.27-8.4 6.88-13.17 1.6-4.77 2.47-9.88 2.47-15.19V83.88h85.58Z"/><path d="M283.53 0v83.2H133.25c-11.74 0-22.5 4.25-30.81 11.3-2.8 2.37-5.33 5.06-7.51 8.02-2.94 3.96-5.28 8.39-6.88 13.16-1.6 4.77-2.47 9.88-2.47 15.19v153.1H0v-107.03c0-20.82 8.31-39.71 21.8-53.52L122.78 22.44C136.43 8.79 155.21.26 175.97 0h107.56Z"/></svg>`;

const sectionHead = (num: string, title: string, lead: string): string => `
  <div class="s-head">
    <div class="s-num"><span class="s-dot"></span>${num}</div>
    <h2 class="s-title">${title}</h2>
    <p class="s-lead">${lead}</p>
  </div>`;

const kpiLabel = (label: string): string =>
  `<div class="kpi-label"><span class="kpi-dot"></span>${label}</div>`;

const kpiValue = (
  value: number | null,
  opts: { suffix?: string; compact?: boolean; decimal?: boolean } = {},
): string => {
  if (value === null) {
    // The mockup cascade renders the STACKED cells' pending at 28px — reproduced like the page.
    return `<div class="kpi-pending${opts.compact ? ' kpi-pending--stack' : ''}">${PENDING}</div>`;
  }
  const suffix = opts.suffix ? `<span class="kpi-suffix">${opts.suffix}</span>` : '';
  const formatted = opts.decimal ? formatDecimalFr(value) : formatIntFr(value);
  return `<div class="kpi-value${opts.compact ? ' kpi-value--stack' : ''}">${formatted}${suffix}</div>`;
};

/** Inline SVG area chart for S03 (the sim-chart idiom: plantation stroke, soft gradient). */
export function impressionsChartSvg(days: DailyImpressionsPoint[]): string {
  const W = 800;
  const H = 260;
  const PAD = 10;
  const max = Math.max(1, ...days.map((d) => d.impressions));
  const n = Math.max(1, days.length - 1);
  const x = (i: number): number => PAD + (i * (W - 2 * PAD)) / n;
  const y = (v: number): number => H - PAD - (v / max) * (H - 2 * PAD);
  const pts = (days.length === 1 ? [days[0], days[0]] : days).map(
    (d, i) => `${x(i).toFixed(1)},${y(d?.impressions ?? 0).toFixed(1)}`,
  );
  const first = pts[0] ?? `${PAD},${H - PAD}`;
  const last = pts[pts.length - 1] ?? `${W - PAD},${H - PAD}`;
  const lastX = last.split(',')[0];
  const firstX = first.split(',')[0];
  return `<svg class="s03-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="impGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#204B43" stop-opacity="0.2"/><stop offset="100%" stop-color="#204B43" stop-opacity="0"/>
    </linearGradient></defs>
    <path d="M${pts.join(' L')} L${lastX},${H - PAD} L${firstX},${H - PAD} Z" fill="url(#impGrad)"/>
    <path d="M${pts.join(' L')}" fill="none" stroke="#204B43" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

const heatmapHtml = (levels: number[][]): string => {
  const hachure = 'cell-h';
  const rows = DAY_LABELS.map((label, day) => {
    const cells = (levels[day] ?? Array.from({ length: 14 }, () => 0))
      .map((level) =>
        level === 0
          ? `<div class="hm-cell ${hachure}"></div>`
          : `<div class="hm-cell" style="background:${RAMP[level - 1]}"></div>`,
      )
      .join('');
    return `<div class="hm-day">${label}</div>${cells}`;
  }).join('');
  const legend = RAMP.map((c) => `<span class="hm-step" style="background:${c}"></span>`).join('');
  return `
  <div class="card hm-wrap">
    <div class="hm-grid">
      <div></div>${HOUR_LABELS.map((h) => `<div class="hm-hour">${h}</div>`).join('')}
      ${rows}
    </div>
    <div class="hm-legend mono">Faible <span class="hm-scale">${legend}</span> Élevée</div>
  </div>`;
};

const demoRow = (label: string, countLabel: string | null, barPct: number): string => `
  <div class="demo-row">
    <span class="demo-label">${label}</span>
    ${
      countLabel === null
        ? `<span class="demo-pending mono">${PENDING}</span>`
        : `<span class="demo-value mono"><span class="var">${countLabel}</span> pers.</span>`
    }
  </div>
  <div class="demo-bar"><div class="demo-fill" style="width:${Math.max(0, Math.min(100, barPct))}%"></div></div>`;

export function renderReportHtml(data: ReportData): string {
  const { kpis, hostHasData, castHasData } = data;

  // ── intro strip (its four cells are ALSO echoed on the cover — one builder keeps them in
  //    sync) ──────────────────────────────────────────────────────────────────────────────────
  const introCells = `
    <div class="intro-cell"><div class="intro-label mono">Commerce</div><div class="intro-value"><span class="var">${esc(data.venueName)}</span></div></div>
    <div class="intro-cell"><div class="intro-label mono">Période analysée</div><div class="intro-value"><span class="var">${formatDateFr(data.range.from)}</span> – <span class="var">${formatDateFr(data.range.to)}</span></div></div>
    <div class="intro-cell"><div class="intro-label mono">Catégorie</div><div class="intro-value"><span class="var">${esc(data.category)}</span></div></div>
    <div class="intro-cell"><div class="intro-label mono">Campagnes incluses</div><div class="intro-value"><span class="var">${castHasData ? String(data.campaignsBlock.count) : PENDING}</span></div></div>`;
  const intro = `
  <div class="intro">${introCells}
  </div>`;

  // ── cover page ───────────────────────────────────────────────────────────────────────────────
  const cover = `
  <section class="cover">
    <div class="cover-brand">${brandMark('cover-mark')}<span class="cover-word">tood<b>oo</b>h</span></div>
    <div class="cover-main">
      <div class="cover-accent"><span class="acc-mint"></span><span class="acc-portage"></span></div>
      <div class="cover-eyebrow mono">Rapport de performances</div>
      <h1 class="cover-venue">${esc(data.venueName)}</h1>
      <div class="cover-cat">${esc(data.category)}</div>
      <div class="cover-period mono"><span class="var">${formatDateFr(data.range.from)}</span> – <span class="var">${formatDateFr(data.range.to)}</span></div>
    </div>
    <div class="cover-bottom">
      <div class="cover-facts">${introCells}
      </div>
      <div class="cover-generated mono">Généré le ${data.generatedLabel}</div>
    </div>
  </section>`;

  // ── running header + footer (Chromium-sandboxed: inline styles, no page classes/webfonts) ────
  const pdfChrome = `
  <template id="pdf-header"><div style="width:100%;font-family:'Geist Mono','Courier New',monospace;font-size:7px;color:#8A9E92;padding:0 12mm;text-align:right;">${esc(data.venueName)} · ${formatDateFr(data.range.from)} – ${formatDateFr(data.range.to)}</div></template>
  <template id="pdf-footer"><div style="width:100%;font-size:7px;color:#8A9E92;padding:0 12mm;display:flex;justify-content:space-between;align-items:baseline;"><span style="display:inline-flex;align-items:baseline;gap:5px;"><span style="font-family:'Geist Mono','Courier New',monospace;font-size:6px;letter-spacing:0.14em;color:#8A9E92;">POWERED BY</span><span style="font-family:'Geist','Helvetica Neue',Arial,sans-serif;font-weight:600;font-size:8px;color:#10251A;">tood<span style="color:#1D9E75">oo</span>h</span></span><span style="font-family:'Geist Mono','Courier New',monospace;">page <span class="pageNumber"></span> / <span class="totalPages"></span></span></div></template>`;

  // ── S01 ────────────────────────────────────────────────────────────────────────────────────
  const s01 = `
  <section class="section">
    ${sectionHead('Section 01', 'Votre audience en chiffres', "Indicateurs de densité d'audience mesurés dans votre lieu sur la période analysée, croisés avec vos heures d'ouverture.")}
    <div class="kpi-row">
      <div class="kpi-cell">
        ${kpiLabel('Audience globale')}
        ${kpiValue(hostHasData ? kpis.global : null)}
        <p class="kpi-detail">Personnes mesurées dans votre lieu sur la période.</p>
      </div>
      <div class="kpi-cell kpi-cell--stack">
        <div>
          ${kpiLabel('Audience moyenne / heure')}
          ${kpiValue(hostHasData ? (kpis.perHour ?? 0) : null, { suffix: 'pers/h', compact: true, decimal: true })}
          <p class="kpi-detail">Densité moyenne d'audience pendant les heures d'ouverture.</p>
        </div>
        <div>
          ${kpiLabel('Audience moyenne / jour')}
          ${kpiValue(hostHasData ? (kpis.perDay ?? 0) : null, { compact: true })}
          <p class="kpi-detail">Personnes par jour d'ouverture en moyenne.</p>
        </div>
      </div>
      <div class="kpi-cell kpi-cell--last">
        ${kpiLabel("Pic d'audience")}
        ${kpiValue(hostHasData ? (kpis.peak?.value ?? 0) : null)}
        <p class="kpi-detail">Maximum observé — <span class="var">${kpis.peak ? formatDateFr(kpis.peak.date) : 'JJ/MM/AAAA'}</span></p>
      </div>
    </div>
  </section>`;

  // ── S02 ────────────────────────────────────────────────────────────────────────────────────
  const s02 = `
  <section class="section">
    ${sectionHead('Section 02', 'Vos peak hours', "Audience moyenne croisant les jours de la semaine et les heures d'ouverture, sur l'ensemble de la période. Plus la couleur est vive, plus l'audience est élevée. Les zones rayées correspondent à vos heures de fermeture.")}
    ${heatmapHtml(data.heatLevels)}
  </section>`;

  // ── S03 ────────────────────────────────────────────────────────────────────────────────────
  const s03Chart =
    castHasData && data.days.length > 0
      ? `<div class="chart-wrap">${impressionsChartSvg(data.days)}</div>`
      : `<div class="chart-placeholder">${CHART_PENDING}</div>`;
  const s03 = `
  <section class="section">
    ${sectionHead('Section 03', 'Évolution des impressions', "Volume d'impressions servies dans votre lieu, jour par jour, sur la période analysée.")}
    <div class="card">
      <div class="chart-head"><div class="chart-title">Impressions par jour</div><div class="chart-sub mono">Sur la période sélectionnée</div></div>
      ${s03Chart}
      <div class="chart-legend mono"><span class="legend-dash"></span>Impressions servies</div>
    </div>
  </section>`;

  // ── S04 ────────────────────────────────────────────────────────────────────────────────────
  const demoPending = !hostHasData || data.breakdown === null;
  const b = data.breakdown;
  const sexeMax = b ? Math.max(b.femmes, b.hommes) : 0;
  const ageMax = b ? Math.max(...b.ages.map((band) => band.count)) : 0;
  const sexeRows = demoPending
    ? demoRow('Femmes', null, PLACEHOLDER_SEXE_PCT[0] ?? 0) +
      demoRow('Hommes', null, PLACEHOLDER_SEXE_PCT[1] ?? 0)
    : demoRow(
        'Femmes',
        formatIntFr(b?.femmes ?? 0),
        sexeMax > 0 ? ((b?.femmes ?? 0) / sexeMax) * 100 : 0,
      ) +
      demoRow(
        'Hommes',
        formatIntFr(b?.hommes ?? 0),
        sexeMax > 0 ? ((b?.hommes ?? 0) / sexeMax) * 100 : 0,
      );
  const ageBands = b?.ages ?? [
    { label: '17 – 30 ans', count: 0 },
    { label: '31 – 45 ans', count: 0 },
    { label: '46 – 60 ans', count: 0 },
    { label: '60 ans et plus', count: 0 },
  ];
  const ageRows = ageBands
    .map((band, idx) =>
      demoPending
        ? demoRow(band.label, null, PLACEHOLDER_AGE_PCT[idx] ?? 0)
        : demoRow(
            band.label,
            formatIntFr(band.count),
            ageMax > 0 ? (band.count / ageMax) * 100 : 0,
          ),
    )
    .join('');
  const s04 = `
  <section class="section">
    ${sectionHead('Section 04', 'Profil typologique de votre clientèle', "Photographie typologique de l'audience qui fréquente votre lieu, établie à partir des mesures réalisées dans un établissement pilote de votre catégorie.")}
    <div class="note note--green">
      <p><strong>Comment lire ce profil.</strong> Les répartitions par sexe et tranche d'âge proviennent des mesures réalisées dans un lieu pilote représentatif de la catégorie « <span class="var">${esc(data.category === '—' ? 'Catégorie de lieu' : data.category)}</span> ». Elles sont exprimées ici en nombre de personnes estimées, et non en pourcentage.</p>
    </div>
    <div class="demo-grid">
      <div><h4 class="demo-h mono">Répartition par sexe</h4>${sexeRows}</div>
      <div><h4 class="demo-h mono">Répartition par tranche d'âge</h4>${ageRows}</div>
    </div>
  </section>`;

  // ── S05 ────────────────────────────────────────────────────────────────────────────────────
  const revenueHead = castHasData
    ? `<div class="rev-total"><span class="var-portage">${data.revenue.totalLabel}</span><span class="rev-suffix">TND</span></div>`
    : `<div class="rev-avenir">À venir</div><p class="rev-note">Vos premiers gains arrivent dès le lancement des campagnes.</p>`;
  const revenueCount = castHasData
    ? `<div class="rev-count"><span class="var">${data.revenue.count}</span> diffusées</div>`
    : `<div class="rev-count">0 <span class="rev-count-soft">pour l'instant</span></div>`;
  const revenueBody = !castHasData
    ? `<div class="callout callout--green"><div><strong>Vos écrans sont prêts à recevoir nos annonceurs.</strong> Conservez un score de priorité élevé pour capter les premiers budgets dès leur déploiement.</div></div>`
    : data.revenue.rows.length === 0
      ? `<div class="list-head mono"><span>Détail par campagne</span><span>Votre revenu</span></div>
         <div class="list-empty">${NO_CAMPAIGN_IN_PERIOD}</div>`
      : `<div class="list-head mono"><span>Détail par campagne</span><span>Votre revenu</span></div>
         ${data.revenue.rows
           .map(
             (row) =>
               `<div class="camp-row"><span class="camp-name">${esc(row.name)}</span><span class="camp-period mono">${esc(row.period)}</span><span class="camp-amount mono">${row.amountLabel}</span></div>`,
           )
           .join('')}`;
  const s05 = `
  <section class="section">
    ${sectionHead('Section 05', 'Vos revenus de la période', 'Voici le total de vos revenus pour la période analysée, avec le détail des campagnes qui les ont générés.')}
    <div class="card">
      <div class="rev-head">
        <div class="rev-left">
          <div class="rev-icon">${brandMark('rev-mark')}</div>
          <div><div class="rev-label mono">Revenu cumulé</div>${revenueHead}</div>
        </div>
        <div class="rev-right"><div class="rev-label mono">Campagnes</div>${revenueCount}</div>
      </div>
      ${revenueBody}
      <div class="rev-footnote">${brandMark('foot-mark')} Calculé sur les impressions effectivement servies dans votre lieu pendant chaque campagne</div>
    </div>
  </section>`;

  // ── S06 ────────────────────────────────────────────────────────────────────────────────────
  const cb = data.campaignsBlock;
  const top3Rows = [0, 1, 2]
    .map(
      (idx) =>
        `<div class="top3-row"><span class="top3-rank${idx === 0 ? ' top3-rank--first' : ''}">${idx + 1}</span><span class="top3-name"><span class="var">${esc(cb.top3[idx] ?? 'Nom de la campagne')}</span></span></div>`,
    )
    .join('');
  const historyBlock = !castHasData
    ? `<div class="list-empty card">${PENDING}.</div>`
    : cb.rows.length === 0
      ? `<div class="list-empty card">${NO_CAMPAIGN_IN_PERIOD}</div>`
      : `<table class="hist-table">
          <thead><tr><th class="mono">Campagne</th><th class="mono">Période</th><th class="mono">Type</th><th class="mono">Statut</th><th class="mono">Impressions</th><th class="mono th-right">Revenu</th></tr></thead>
          <tbody>${cb.rows
            .map(
              (row) =>
                `<tr><td>${esc(row.name)}</td><td>${esc(row.period)}</td><td>${esc(row.typeLabel)}</td><td><span class="pill mono${row.statut === 'Active' ? ' pill--active' : ''}"><span class="pill-dot"></span>${row.statut}</span></td><td>${row.impressionsLabel}</td><td class="td-amount mono">${row.revenueLabel}</td></tr>`,
            )
            .join('')}</tbody>
        </table>`;
  const s06 = `
  <section class="section">
    ${sectionHead('Section 06', 'Vos campagnes', 'Synthèse et historique des campagnes diffusées dans votre lieu sur la période analysée.')}
    <h3 class="sub-title">Vos campagnes en chiffres</h3>
    <p class="sub-lead">Synthèse des campagnes diffusées dans votre lieu sur la période analysée.</p>
    <div class="kpi-row">
      <div class="kpi-cell">
        ${kpiLabel('Campagnes diffusées')}
        ${castHasData ? `<div class="kpi-value">${cb.count}</div>` : `<div class="kpi-pending">${PENDING}</div>`}
        <p class="kpi-detail">Nombre de campagnes ayant tourné dans votre lieu sur la période</p>
      </div>
      <div class="kpi-cell">
        ${kpiLabel('Impressions cumulées')}
        ${castHasData ? `<div class="kpi-value">${formatIntFr(cb.cumulativeImpressions)}</div>` : `<div class="kpi-pending">${PENDING}</div>`}
        <p class="kpi-detail">Total des impressions servies sur la période analysée</p>
      </div>
      <div class="kpi-cell kpi-cell--last">
        ${kpiLabel('Top 3 campagnes')}
        <div class="top3">${top3Rows}</div>
      </div>
    </div>
    <h3 class="sub-title">Historique des campagnes</h3>
    <p class="sub-lead">Détail campagne par campagne sur la période analysée, avec leurs principaux indicateurs de performance.</p>
    ${historyBlock}
  </section>`;

  // ── S07 (the page's three GENERIC pistes, copy verbatim) ────────────────────────────────────
  const s07 = `
  <section class="section">
    ${sectionHead('Section 07', "Vos pistes d'optimisation futures", "Quelques observations issues de l'activité de votre lieu sur la période, transformées en pistes concrètes pour développer vos revenus.")}
    <div class="note note--violet">
      <p><strong>Lecture personnalisée.</strong> Ces pistes s'appuient sur les données mesurées dans votre lieu — audience, profil typologique, performance des campagnes diffusées.</p>
    </div>
    <div class="reco-card"><div class="reco-num mono reco-num--portage"><span class="reco-dot reco-dot--portage"></span>Piste 01</div><h3 class="reco-title">Anticipez les temps forts</h3><p class="reco-body">Un grand match international est à l'affiche ce mois-ci (Coupe du Monde, CAN…) — profitez-en pour communiquer sa diffusion et inviter vos clients à venir le suivre dès maintenant sur vos réseaux.</p></div>
    <div class="reco-card"><div class="reco-num mono reco-num--green"><span class="reco-dot reco-dot--green"></span>Piste 02</div><h3 class="reco-title">Repérez vos angles morts</h3><p class="reco-body">Vous avez 2 périodes creuses à valoriser autrement. Mardi matin et jeudi après-midi sont vos créneaux les plus faibles — essayez X et Y pour les redynamiser.</p></div>
    <div class="reco-card"><div class="reco-num mono reco-num--deep"><span class="reco-dot reco-dot--deep"></span>Piste 03</div><h3 class="reco-title">Résumé du SPS et recommandations</h3><p class="reco-body reco-body--pending">En attente de votre score de priorité.</p></div>
  </section>`;

  // ── S08 (SPS — permanently the "À venir" variant, ruled) ────────────────────────────────────
  const criteria = [
    ['Acceptation des campagnes', 'poids 25 %'],
    ['Respect des événements acceptés', 'poids 30 %'],
    ['Activité de votre écran', 'poids 20 %'],
    ['Taux de remplissage', 'poids 10 %'],
  ]
    .map(
      ([name, weight]) => `
      <div class="sps-criterion">
        <div class="sps-name">${name} <span class="sps-weight mono">${weight}</span></div>
        <div class="sps-value mono">À venir</div>
        <div class="sps-bar"></div>
      </div>`,
    )
    .join('');
  const s08 = `
  <section class="section">
    ${sectionHead('Section 08', 'Votre score de priorité', 'Le score de priorité reflète votre engagement sur la plateforme. Plus il est élevé, plus vous êtes positionné en priorité quand de nouvelles campagnes sont à diffuser dans le réseau.')}
    <div class="card sps-card">
      <div class="sps-badge"><div class="sps-badge-label mono">Classement</div><div class="sps-badge-value">À venir</div></div>
      <div class="sps-headline"><div class="sps-label mono">Score actuel</div><div class="sps-score">À venir</div></div>
      ${criteria}
      <div class="sps-explainer"><p><strong>Comment lire votre score.</strong> Votre score est mis à jour à chaque campagne ou événement. Votre score et votre classement sont strictement personnels — vous êtes le seul à pouvoir les consulter.</p></div>
    </div>
  </section>`;

  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<style>
@import url('https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600;700;800&family=Geist+Mono:wght@400;500;600&display=swap');
:root{
  --page:#F5F6F8; --card:#FFFFFF; --line:#E9EBEF; --soft:#F0F1F4;
  --ink:#10251A; --grey:#5B6E63; --mist:#8A9E92;
  --mint:#76E6AB; --green:#1D9E75; --portage:#9195F8; --deep:#204B43; --lavender:#ECEDFD;
}
*{box-sizing:border-box;margin:0;padding:0;}
body{font-family:'Geist',-apple-system,system-ui,sans-serif;background:var(--page);color:var(--ink);
  font-size:12px;line-height:1.5;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
.mono{font-family:'Geist Mono','SF Mono',Monaco,monospace;}
.var{font-family:'Geist Mono','SF Mono',Monaco,monospace;font-weight:500;color:var(--green);font-size:0.92em;white-space:nowrap;}
.var-portage{font-weight:600;color:var(--portage);}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:16px;break-inside:avoid;}
/* cover page — one full page (A4 content box at the chromed margins is ~260mm tall), then a
   hard break into the page-mirror. White, mint/portage accents, generous edge whitespace so the
   running chrome (which Chromium also prints on page 1) sits clear of the composition. */
.cover{height:259mm;display:flex;flex-direction:column;break-after:page;background:var(--card);padding:0 2mm;}
.cover-brand{display:flex;align-items:center;gap:10px;padding-top:2mm;}
.cover-mark{width:30px;height:25px;color:var(--mint);}
.cover-word{font-size:21px;font-weight:600;letter-spacing:-0.01em;}
.cover-word b{color:var(--green);font-weight:600;}
.cover-main{flex:1;display:flex;flex-direction:column;justify-content:center;}
.cover-accent{display:flex;gap:4px;margin-bottom:20px;}
.cover-accent span{height:4px;border-radius:2px;}
.acc-mint{width:36px;background:var(--mint);}
.acc-portage{width:12px;background:var(--portage);}
.cover-eyebrow{font-size:10px;letter-spacing:0.16em;text-transform:uppercase;color:var(--green);font-weight:600;margin-bottom:16px;}
.cover-venue{font-size:40px;font-weight:600;letter-spacing:-0.03em;line-height:1.05;margin-bottom:10px;}
.cover-cat{font-size:13px;color:var(--grey);margin-bottom:24px;}
.cover-period{font-size:10px;color:var(--grey);}
.cover-facts{display:grid;grid-template-columns:repeat(4,1fr);border-top:1px solid var(--line);border-bottom:1px solid var(--line);padding:12px 0;margin-bottom:14px;}
.cover-generated{font-size:9px;color:var(--mist);}
/* intro strip */
.intro{display:grid;grid-template-columns:repeat(4,1fr);border-top:1px solid var(--line);border-bottom:1px solid var(--line);padding:12px 0;margin-bottom:26px;break-inside:avoid;}
.intro-cell{padding:0 12px;border-right:1px solid var(--soft);min-width:0;}
.intro-cell:first-child{padding-left:0;}
.intro-cell:last-child{border-right:none;}
.intro-label{font-size:7.5px;letter-spacing:0.08em;text-transform:uppercase;color:var(--mist);margin-bottom:5px;}
.intro-value{font-size:11px;font-weight:600;letter-spacing:-0.012em;}
/* sections */
.section{margin-bottom:30px;}
/* the whole heading block is atomic AND glued to its first content block — no orphaned
   eyebrows/titles at page bottoms */
.s-head{break-inside:avoid;break-after:avoid;}
.sub-title,.sub-lead{break-after:avoid;}
.s-num{display:inline-flex;align-items:center;gap:6px;font-family:'Geist Mono',monospace;font-size:8px;letter-spacing:0.12em;text-transform:uppercase;color:var(--green);font-weight:600;margin-bottom:7px;}
.s-dot{width:4px;height:4px;border-radius:50%;background:var(--green);}
.s-title{font-size:18px;font-weight:600;line-height:1.15;letter-spacing:-0.015em;margin-bottom:6px;}
.s-lead{font-size:10px;color:var(--grey);line-height:1.6;max-width:440px;margin-bottom:14px;}
.sub-title{font-size:13px;font-weight:600;letter-spacing:-0.01em;margin-top:18px;}
.sub-lead{font-size:9.5px;color:var(--grey);max-width:400px;margin:3px 0 12px;}
/* KPI rows */
.kpi-row{display:grid;grid-template-columns:repeat(3,1fr);border-top:2px solid var(--green);border-bottom:1px solid var(--line);break-inside:avoid;}
.kpi-cell{padding:14px 14px 14px 0;border-right:1px solid var(--soft);}
.kpi-cell+.kpi-cell{padding-left:14px;}
.kpi-cell--last{border-right:none;padding-right:0;}
.kpi-cell--stack>div+div{margin-top:12px;}
.kpi-label{display:flex;align-items:center;gap:5px;font-family:'Geist Mono',monospace;font-size:7px;letter-spacing:0.1em;text-transform:uppercase;color:var(--mist);margin-bottom:8px;}
.kpi-dot{width:3.5px;height:3.5px;border-radius:50%;background:var(--mist);opacity:.7;}
.kpi-value{font-size:30px;font-weight:600;letter-spacing:-0.03em;line-height:1;margin-bottom:6px;}
.kpi-value--stack{font-size:19px;margin-bottom:3px;}
.kpi-suffix{font-size:11px;font-weight:500;color:var(--grey);margin-left:3px;letter-spacing:normal;}
.kpi-pending{font-size:11px;font-weight:600;font-style:italic;color:var(--mist);margin-bottom:6px;}
.kpi-pending--stack{font-size:19px;line-height:1.2;}
.kpi-detail{font-size:8.5px;color:var(--grey);line-height:1.45;}
/* heatmap */
.hm-wrap{padding:14px;}
.hm-grid{display:grid;grid-template-columns:34px repeat(14,1fr);gap:2.5px;}
.hm-hour{font-family:'Geist Mono',monospace;font-size:7px;color:var(--mist);text-align:center;padding-bottom:4px;}
.hm-day{font-family:'Geist Mono',monospace;font-size:7.5px;color:var(--grey);text-transform:uppercase;letter-spacing:0.05em;align-self:center;padding-right:4px;}
.hm-cell{height:15px;border-radius:2.5px;}
.cell-h{background:repeating-linear-gradient(-45deg,#F1F5F3,#F1F5F3 3px,#E4ECE7 3px,#E4ECE7 6px);}
.hm-legend{display:flex;align-items:center;gap:6px;margin-top:10px;font-size:7px;color:var(--grey);text-transform:uppercase;letter-spacing:0.04em;}
.hm-scale{display:inline-flex;gap:2px;}
.hm-step{width:9px;height:9px;border-radius:2px;display:inline-block;}
/* S03 chart */
.chart-head{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:10px;}
.chart-title{font-size:12px;font-weight:600;}
.chart-sub{font-size:8px;color:var(--mist);}
.chart-wrap{border:1px solid var(--line);border-radius:8px;padding:8px 10px;background:#fff;}
.s03-chart{width:100%;height:auto;display:block;}
.chart-placeholder{background:#F6F8FA;border:1px dashed var(--soft);border-radius:8px;display:flex;align-items:center;justify-content:center;text-align:center;color:var(--mist);font-style:italic;font-size:9.5px;padding:34px 14px;}
.chart-legend{display:flex;align-items:center;gap:5px;margin-top:9px;font-size:7px;color:var(--grey);text-transform:uppercase;letter-spacing:0.04em;}
.legend-dash{width:8px;height:2.5px;background:var(--deep);border-radius:2px;display:inline-block;}
/* notes + callouts */
.note{display:flex;gap:9px;padding:11px 14px;border:1px solid var(--line);border-left:3px solid var(--green);border-radius:5px;margin-bottom:16px;break-inside:avoid;}
.note--green{background:#E7F5EE;}
.note--violet{background:#E3EBE8;border-left-color:var(--deep);}
.note p{font-size:9px;line-height:1.6;color:var(--grey);}
.note strong{color:var(--ink);font-weight:600;}
.callout--green{display:flex;gap:8px;background:#E8F6ED;border:1px solid var(--line);border-left:3px solid var(--green);border-radius:5px;padding:10px 13px;font-size:9.5px;color:var(--ink);line-height:1.6;break-inside:avoid;}
/* S04 demo */
.demo-grid{display:grid;grid-template-columns:1fr 1fr;gap:26px;break-inside:avoid;}
.demo-h{font-size:7px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:var(--grey);margin-bottom:10px;padding-bottom:7px;border-bottom:1px solid var(--line);}
.demo-row{display:flex;justify-content:space-between;align-items:baseline;gap:8px;margin-top:10px;margin-bottom:4px;}
.demo-label{font-size:9.5px;}
.demo-value{font-size:9px;font-weight:500;}
.demo-pending{font-size:8px;font-style:italic;color:var(--mist);font-weight:500;}
.demo-bar{height:3.5px;background:var(--soft);border-radius:2px;overflow:hidden;}
.demo-fill{height:100%;background:var(--green);border-radius:2px;}
/* S05 revenue */
.rev-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;padding-bottom:13px;border-bottom:1px solid var(--line);margin-bottom:14px;}
.rev-left{display:flex;align-items:center;gap:9px;}
.rev-icon{width:26px;height:26px;border-radius:7px;background:var(--lavender);display:flex;align-items:center;justify-content:center;color:var(--portage);}
.rev-mark{width:13px;height:11px;}
.rev-label{font-size:7px;letter-spacing:0.08em;text-transform:uppercase;color:var(--mist);margin-bottom:4px;}
.rev-total{font-size:21px;font-weight:600;line-height:1.1;}
.rev-suffix{font-size:10.5px;color:var(--grey);margin-left:3px;font-weight:400;}
.rev-avenir{font-size:21px;font-weight:600;line-height:1.1;}
.rev-note{font-size:8.5px;font-style:italic;color:var(--mist);margin-top:3px;}
.rev-right{text-align:right;}
.rev-count{font-size:13px;font-weight:600;}
.rev-count-soft{font-size:9px;font-weight:500;color:var(--mist);}
.list-head{display:flex;justify-content:space-between;font-size:7px;letter-spacing:0.08em;text-transform:uppercase;color:var(--mist);margin-bottom:6px;}
.list-empty{padding:18px 4px;text-align:center;font-size:9.5px;font-style:italic;color:var(--mist);}
.list-empty.card{padding:22px 14px;}
.camp-row{display:grid;grid-template-columns:1fr auto auto;gap:12px;align-items:center;padding:8px 0;border-bottom:1px solid var(--soft);}
.camp-row:last-of-type{border-bottom:none;}
.camp-name{font-size:9.5px;font-weight:500;}
.camp-period{font-size:8px;color:var(--mist);white-space:nowrap;}
.camp-amount{font-size:9.5px;color:var(--portage);font-weight:600;white-space:nowrap;}
.rev-footnote{display:flex;align-items:center;gap:5px;margin-top:11px;font-size:8px;color:var(--mist);}
.foot-mark{width:8px;height:7px;opacity:.7;flex-shrink:0;}
/* S06 top3 + table */
.top3{display:flex;flex-direction:column;gap:8px;margin-top:8px;}
.top3-row{display:flex;align-items:baseline;gap:7px;}
.top3-rank{width:10px;font-size:11px;font-weight:600;color:var(--mist);flex-shrink:0;}
.top3-rank--first{color:var(--green);}
.top3-name{font-size:9.5px;}
.hist-table{width:100%;border-collapse:collapse;font-size:9px;break-inside:avoid;}
.hist-table th{text-align:left;font-size:7px;letter-spacing:0.08em;text-transform:uppercase;color:var(--mist);padding:0 8px 7px 0;border-bottom:2px solid var(--deep);font-weight:600;}
.hist-table th.th-right{text-align:right;padding-right:0;}
.hist-table td{padding:8px 8px 8px 0;border-bottom:1px solid var(--soft);vertical-align:middle;}
.td-amount{text-align:right;color:var(--portage);font-weight:600;padding-right:0 !important;}
.pill{display:inline-flex;align-items:center;gap:4px;font-size:8px;color:var(--grey);}
.pill-dot{width:4px;height:4px;border-radius:50%;background:var(--mist);display:inline-block;}
.pill--active{color:var(--green);}
.pill--active .pill-dot{background:var(--green);}
/* S07 pistes */
.reco-card{background:var(--card);border:1px dashed var(--line);border-radius:8px;padding:13px 16px;margin-bottom:9px;break-inside:avoid;}
.reco-num{display:inline-flex;align-items:center;gap:5px;font-size:7px;letter-spacing:0.1em;text-transform:uppercase;font-weight:600;margin-bottom:5px;}
.reco-num--portage{color:var(--portage);}
.reco-num--green{color:var(--green);}
.reco-num--deep{color:var(--deep);}
.reco-dot{width:3.5px;height:3.5px;border-radius:50%;display:inline-block;}
.reco-dot--portage{background:var(--portage);}
.reco-dot--green{background:var(--green);}
.reco-dot--deep{background:var(--deep);}
.reco-title{font-size:11.5px;font-weight:600;letter-spacing:-0.01em;margin-bottom:4px;}
.reco-body{font-size:9px;color:var(--grey);line-height:1.6;}
.reco-body--pending{font-style:italic;color:var(--mist);}
/* S08 SPS */
.sps-card{position:relative;padding:20px;}
.sps-badge{position:absolute;top:15px;right:17px;text-align:right;padding:6px 10px;background:var(--lavender);border:1px solid var(--line);border-radius:7px;}
.sps-badge-label{font-size:6.5px;letter-spacing:0.1em;text-transform:uppercase;color:var(--mist);}
.sps-badge-value{font-size:10px;font-weight:600;color:var(--portage);margin-top:2px;}
.sps-headline{margin-bottom:16px;padding-bottom:13px;border-bottom:1px solid var(--line);padding-right:90px;}
.sps-label{font-size:7px;letter-spacing:0.1em;text-transform:uppercase;color:var(--mist);}
.sps-score{font-size:30px;font-weight:600;letter-spacing:-0.025em;line-height:1;margin-top:7px;}
.sps-criterion{margin-bottom:11px;}
.sps-name{font-size:9.5px;margin-bottom:4px;}
.sps-weight{font-size:7px;color:var(--mist);}
.sps-value{font-size:8.5px;font-style:italic;color:var(--mist);font-weight:500;margin-bottom:4px;}
.sps-bar{height:3.5px;background:var(--soft);border-radius:2px;}
.sps-explainer{padding-top:13px;border-top:1px solid var(--line);margin-top:14px;}
.sps-explainer p{font-size:8px;color:var(--mist);line-height:1.6;}
.sps-explainer strong{color:var(--grey);font-weight:600;}
</style>
</head>
<body>
  ${cover}
  ${intro}
  ${s01}
  ${s02}
  ${s03}
  ${s04}
  ${s05}
  ${s06}
  ${s07}
  ${s08}
  ${pdfChrome}
</body>
</html>`;
}
