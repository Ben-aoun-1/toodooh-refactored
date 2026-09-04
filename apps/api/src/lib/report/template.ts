import { PROVENANCE_LABELS, type ProvenanceKind } from './affluence-provenance.js';
import type { ReportData } from './assemble.js';
import { coverageLabel, daysInRange } from './coverage.js';
import { demoBarPct } from './demographic-bar.js';
import {
  type DailyImpressionsPoint,
  formatDateFr,
  formatDecimalFr,
  formatIntFr,
} from './derive.js';
import { buildPistes } from './pistes.js';

// ONE self-contained HTML document for the report — R1.6: the DEDICATED DARK-THEME design,
// reproduced from the operator-approved mockup (planner: Toodooh_Rapport_Performances.html) —
// five FIXED 210×297mm pages (overflow hidden), deep-green palette, Fraunces display italics +
// Geist/Geist Mono, two radial mint glows per page, in-DOM running head (pages 2–5) and footer
// with SERVER-RENDERED literal page numbers (the count is fixed at 5). French copy VERBATIM from
// the mockup; HOST/CAST empty-state semantics unchanged (En attente du premier deal / À venir).
//
// Ruled deviations from the mockup (Lane R1.6 charter):
// - the app's own SVG brand mark everywhere (never the mockup's base64 rasters);
// - NO JS fit-scaling: the S06 history table caps at 8 rows + a "+ N autres campagnes" summary
//   row (the mockup's transform-scale script is print-unreliable);
// - the heatmap hachure covers BOTH closed hours AND no-data cells (existing semantics under the
//   new look);
// - the mockup's `stat-num{` selector misses its leading dot (a mockup bug) — implemented as
//   `.stat-num`; the unused --portage token is not carried forward (charter watch item);
// - R3 (Mejri item 4): the S03 curve gets LABELED AXES — DD/MM date ticks and impression-count
//   gridlines — overriding the axis-less mockup; the frame renders (unlabeled) in the empty
//   state too.
//
// S07 — PERF-QA2: the three cards come from lib/report/pistes.ts, the ONE generator the owner
// page's /pistes read also calls. R3's « FIXED 3-theme structure, corps 01/03 statiques, langage
// du mockup » was SUPERSEDED on 2026-08-20 (opérateur + architecte) by Mejri's « Retour rapport »
// spec of 13-juil: Piste 01 is an event teaser, Piste 03 is a real SPS analysis. The ruling trail
// and every body live in pistes.ts. opts.aiPistes (a single non-blank string — the historic name
// keeps the job/endpoint/script call sites untouched) still fills Piste 02, and anything else
// keeps the generic angles-morts body verbatim.

const PENDING = 'En attente du premier deal';
const CHART_PENDING = 'Évolution en attente du premier deal';
const NO_CAMPAIGN_IN_PERIOD = 'Aucune campagne sur la période analysée.';

const HOUR_LABELS = Array.from({ length: 14 }, (_, i) => `${i + 8}h`);
/** Slice C — 28 half-hour columns under 14 hour labels, each label spanning its two halves. */
const HEATMAP_COLS = HOUR_LABELS.length * 2;
const DAY_LABELS = ['LUN', 'MAR', 'MER', 'JEU', 'VEN', 'SAM', 'DIM'];

/** Ruled deviation: at most 8 history rows; overflow folds into one summary row. */
export const HIST_MAX_ROWS = 8;
/** Same fixed-page discipline for the S05 detail list (page 3 must never rely on clipping). */
export const REV_MAX_ROWS = 4;

// The S07 titles + bodies USED to live here (R3, « 3 thèmes FIXES »). They moved to
// lib/report/pistes.ts on 2026-08-20 when R3 was superseded by Mejri's 13-juil « Retour
// rapport » spec (PERF-QA2): the bodies became data-driven (événements, SPS), so a constant
// could no longer express them. The RULED asymmetry recorded here survives the move: the static
// generic Piste 02 body is over the 210-char guard that VARIABLE AI bodies must pass, and that
// is fine — it renders 2 lines / 0px overflow by direct measurement.

// PERF-R2 (operator 2026-08-30) — the S02 lead: the semaine type IS période-scoped now (the
// weekdays the période does not contain are masked), each cell merged PAX-first with provenance.
// BYTE-IDENTICAL twin in apps/web (lib/peak-hours.ts), each side pinned by an exact-literal
// test. Page and PDF are RULE-identical.
export const PEAK_HOURS_LEAD =
  "Vos pics d'audience sur la période analysée : pour chaque créneau, la valeur la plus haute enregistrée, croisant les jours de la semaine et les heures d'ouverture — mesure de votre capteur en priorité, estimation en secours. Plus la couleur est vive, plus l'audience est élevée. Les cases pleines sont mesurées par votre capteur, les cases en pointillé sont des estimations. Les zones rayées correspondent à vos heures de fermeture, aux jours hors période ou aux créneaux sans aucune donnée.";

// PERF-R1 (operator 2026-08-30) — the S01 lead + the no-measure note, BYTE-IDENTICAL twins of
// apps/web's AudienceKpisSection literals, pinned on both sides. The note renders ONLY when
// NEITHER a reading NOR a backup cell fed the période (measuredDays 0 AND estimatedPct null).
export const AUDIENCE_KPIS_LEAD =
  "Indicateurs de densité d'audience dans votre lieu sur la période analysée — mesure du capteur en priorité, estimation en secours — croisés avec vos heures d'ouverture.";
export const NO_MEASURE_NOTE =
  "Aucune mesure du capteur d'audience sur la période — les impressions proviennent de la preuve de diffusion, une source indépendante.";

const esc = (value: string): string =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );

/** The TOODOOH mark glyph (the app's own favicon paths), scaled by the CSS class. */
const brandMark = (cls: string): string =>
  `<svg class="${cls}" viewBox="0 0 448.65 367.85" fill="currentColor"><path d="M448.65 83.88v107.03c0 20.82-8.31 39.71-21.8 53.52l-100.98 100.98c-13.65 13.65-32.43 22.17-53.19 22.44H165.12v-83.21H315.4c11.74 0 22.5-4.24 30.81-11.3 2.8-2.37 5.32-5.06 7.51-8.01 2.93-3.97 5.27-8.4 6.88-13.17 1.6-4.77 2.47-9.88 2.47-15.19V83.88h85.58Z"/><path d="M283.53 0v83.2H133.25c-11.74 0-22.5 4.25-30.81 11.3-2.8 2.37-5.33 5.06-7.51 8.02-2.94 3.96-5.28 8.39-6.88 13.16-1.6 4.77-2.47 9.88-2.47 15.19v153.1H0v-107.03c0-20.82 8.31-39.71 21.8-53.52L122.78 22.44C136.43 8.79 155.21.26 175.97 0h107.56Z"/></svg>`;

/** Section header (kicker bullet + title + lead) — the mockup's .sec-* idiom. */
const secHead = (num: string, title: string, lead: string): string => `
    <div class="sec-kicker"><span class="bullet"></span>${num}</div>
    <h2 class="sec-title">${title}</h2>
    <p class="sec-lead">${lead}</p>`;

// ── S03 chart geometry (R3 — labeled axes, Mejri item 4; OVERRIDES the axis-less mockup) ───────
// The svg stretches (preserveAspectRatio="none"), so TEXT never lives inside it: gridlines/tick
// marks are svg (they stretch fine), labels are HTML positioned from the SAME x()/y() mapping —
// alignment is by construction, and the type stays crisp at print size.
const CHART_W = 800;
const CHART_H = 260;
const CHART_PAD_X = 10;
const CHART_PAD_TOP = 12;
const CHART_PAD_BOTTOM = 5;

const chartX = (i: number, days: number): number =>
  CHART_PAD_X + (i * (CHART_W - 2 * CHART_PAD_X)) / Math.max(1, days - 1);
const chartY = (v: number, yMax: number): number =>
  CHART_H - CHART_PAD_BOTTOM - (v / yMax) * (CHART_H - CHART_PAD_TOP - CHART_PAD_BOTTOM);

/** Y scale 0/step/2·step/3·step — step is the first "nice" INTEGER (1|2|2.5|5|10 × 10^k) ≥ max/3. */
const yAxisTicks = (max: number): number[] => {
  const raw = Math.max(1, max) / 3;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step =
    [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw && Number.isInteger(s)) ?? 10 * mag;
  return [0, step, 2 * step, 3 * step];
};

/** Span-aware X ticks: every day when the span holds ≤7 points, else 6 evenly spread ends-included. */
const X_TICK_TARGET = 6;
const xTickIndexes = (days: number): number[] =>
  days <= 7
    ? Array.from({ length: days }, (_, i) => i)
    : Array.from({ length: X_TICK_TARGET }, (_, k) =>
        Math.round((k * (days - 1)) / (X_TICK_TARGET - 1)),
      );

/** DD/MM tick label (the axis is year-less like the S05 periods). */
const ddmm = (iso: string): string => formatDateFr(iso).slice(0, 5);

/**
 * Inline SVG for S03 — the dark-palette area chart, now over its axis frame (gridlines at the
 * Y ticks, a baseline, X tick marks). With NO days it renders the frame alone: the empty state
 * carries the same axes, unlabeled.
 */
export function impressionsChartSvg(days: DailyImpressionsPoint[]): string {
  const max = Math.max(1, ...days.map((d) => d.impressions));
  const ticks = yAxisTicks(max);
  const yMax = ticks[3] ?? 1;
  const grid = ticks
    .map((v) => {
      const gy = chartY(v, yMax).toFixed(1);
      const stroke = v === 0 ? 'rgba(118,230,171,0.28)' : 'rgba(118,230,171,0.12)';
      return `<line x1="${CHART_PAD_X}" y1="${gy}" x2="${CHART_W - CHART_PAD_X}" y2="${gy}" stroke="${stroke}" stroke-width="1"/>`;
    })
    .join('');
  const baseY = chartY(0, yMax);
  const tickXs =
    days.length > 0
      ? xTickIndexes(days.length).map((i) => chartX(i, days.length))
      : Array.from({ length: X_TICK_TARGET }, (_, k) => chartX(k, X_TICK_TARGET));
  const tickMarks = tickXs
    .map(
      (tx) =>
        `<line x1="${tx.toFixed(1)}" y1="${baseY.toFixed(1)}" x2="${tx.toFixed(1)}" y2="${(baseY + 9).toFixed(1)}" stroke="rgba(118,230,171,0.28)" stroke-width="1"/>`,
    )
    .join('');
  if (days.length === 0) {
    return `<svg class="s03-axes" viewBox="0 0 ${CHART_W} ${CHART_H}" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">${grid}${tickMarks}</svg>`;
  }
  const pts = (days.length === 1 ? [days[0], days[0]] : days).map(
    (d, i) =>
      `${chartX(i, Math.max(2, days.length)).toFixed(1)},${chartY(d?.impressions ?? 0, yMax).toFixed(1)}`,
  );
  const first = pts[0] ?? `${CHART_PAD_X},${baseY}`;
  const last = pts[pts.length - 1] ?? `${CHART_W - CHART_PAD_X},${baseY}`;
  const lastX = last.split(',')[0];
  const firstX = first.split(',')[0];
  return `<svg class="s03-chart" viewBox="0 0 ${CHART_W} ${CHART_H}" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="impGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#76E6AB" stop-opacity="0.28"/><stop offset="100%" stop-color="#76E6AB" stop-opacity="0"/>
    </linearGradient></defs>
    ${grid}${tickMarks}
    <path d="M${pts.join(' L')} L${lastX},${baseY.toFixed(1)} L${firstX},${baseY.toFixed(1)} Z" fill="url(#impGrad)"/>
    <path d="M${pts.join(' L')}" fill="none" stroke="#76E6AB" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

/**
 * The full S03 chart figure: Y impression-count labels (left), the plot, DD/MM date labels
 * (below) — all positioned from the svg's own mapping. The empty state keeps its caption and
 * renders the axis frame UNLABELED (no scale to claim before the first deal).
 */
export function impressionsChartBlock(days: DailyImpressionsPoint[]): string {
  const hasData = days.length > 0;
  const max = Math.max(1, ...days.map((d) => d.impressions));
  const ticks = yAxisTicks(max);
  const yMax = ticks[3] ?? 1;
  const yLabels = hasData
    ? ticks
        .map(
          (v) =>
            `<span style="top:${((chartY(v, yMax) / CHART_H) * 100).toFixed(2)}%">${formatIntFr(v)}</span>`,
        )
        .join('')
    : '';
  const xLabels = hasData
    ? xTickIndexes(days.length)
        .map(
          (i) =>
            `<span style="left:${((chartX(i, days.length) / CHART_W) * 100).toFixed(2)}%">${ddmm(days[i]?.date ?? '')}</span>`,
        )
        .join('')
    : '';
  const plot = hasData
    ? impressionsChartSvg(days)
    : `<div class="chart-empty">${impressionsChartSvg([])}<span>${CHART_PENDING}</span></div>`;
  return `<div class="chartfig">
        <div class="chart-ylab">${yLabels}</div>
        <div class="chart-plot">${plot}</div>
        <div class="chart-xlab">${xLabels}</div>
      </div>`;
}

/** AFF1 — the S02 empty state: byte-twin of the page's PEAK_HOURS_EMPTY_TITLE. */
export const PEAK_HOURS_EMPTY_TITLE = "Pas encore de mesure d'audience";

/**
 * 7×14 heat cells — level 0 (closed hour OR no data) hachures; levels 1..5 map to h0..h4. AFF1:
 * a backup (estimation) cell keeps its level class and gets `hest` on top (lighter + dashed
 * outline) — same helper, same provenance as the page. `empty` swaps the grid for the
 * explanatory state (no measured, no backup, no data).
 */
const heatmapHtml = (levels: number[][], kinds: ProvenanceKind[][], empty: boolean): string => {
  if (empty) {
    return `
      <div class="heat-empty"><div class="t">${PEAK_HOURS_EMPTY_TITLE}</div><div class="s">La carte des peak hours apparaîtra ici dès que votre capteur d'audience aura mesuré des passages dans votre établissement.</div></div>`;
  }
  // Slice C — the document follows the DESKTOP rendering: both halves drawn, the hour label
  // spanning them (grid-column: span 2). A PDF has no width to collapse for, so it never collapses
  // an hour at all; every column here is one half-hour slot's own peak (PEAK-MAX1).
  const header =
    `<div class="heat-hlabel"></div>` +
    HOUR_LABELS.map((h) => `<div class="heat-hlabel heat-hspan">${h}</div>`).join('');
  const rows = DAY_LABELS.map((label, day) => {
    const cells = (levels[day] ?? Array.from({ length: HEATMAP_COLS }, () => 0))
      .map((level, col) =>
        level === 0
          ? `<div class="heat-cell hclosed"></div>`
          : `<div class="heat-cell h${level - 1}${kinds[day]?.[col] === 'backup' ? ' hest' : ''}"></div>`,
      )
      .join('');
    return `<div class="heat-dlabel">${label}</div>${cells}`;
  }).join('');
  return `
      <div class="heat-grid">${header}${rows}</div>
      <div class="heat-legend">
        <span>Faible</span>
        <span class="swatch h1"></span><span class="swatch h2"></span><span class="swatch h3"></span><span class="swatch h4"></span>
        <span>Élevée</span>
        <span class="sep"></span>
        <span class="swatch h3"></span><span>${PROVENANCE_LABELS.measured}</span>
        <span class="swatch h3 hest"></span><span>${PROVENANCE_LABELS.backup}</span>
        <span class="swatch hclosed"></span><span>Fermé / aucune donnée</span>
      </div>`;
};

const barRow = (name: string, valueHtml: string, pct: number): string => `
        <div class="bar-row"><div class="bar-top"><span class="name">${name}</span>${valueHtml}</div><div class="bar-track"><div class="bar-fill" style="width:${Math.max(0, Math.min(100, pct))}%"></div></div></div>`;

export function renderReportHtml(
  data: ReportData,
  opts: { aiPistes?: string | null } = {},
): string {
  const { kpis, hostHasData, castHasData } = data;
  const period = `${formatDateFr(data.range.from)} – ${formatDateFr(data.range.to)}`;
  // RPT-COV1 — « 1 jour de données sur 31 », so a thin month says so ON ITS FACE. Mejri had an
  // August report resting on 31/08 alone with nothing in the document admitting it. Deliberately
  // NOT a minimum-data threshold: a month with real data still gets its report.
  const coverage = coverageLabel({
    daysWithData: data.coverageDays,
    daysInPeriod: daysInRange(data.range.from, data.range.to),
  });

  // ── shared chrome ────────────────────────────────────────────────────────────────────────────
  const runhead = `
  <div class="runhead">${esc(data.venueName)} · ${period}</div>`;
  const footer = (page: number): string => `
  <div class="footer">
    <div class="footer__brand"><span>Powered by</span>${brandMark('footer__mark')}<span class="footer__word">tood<b>oo</b>h</span></div>
    <div class="footer__page">page ${page} / 5</div>
  </div>`;

  const metastrip = `
  <div class="metastrip">
    <div class="cell"><div class="lbl">Commerce</div><div class="val">${esc(data.venueName)}</div></div>
    <div class="cell"><div class="lbl">Période analysée</div><div class="val"><span class="accent">${period}</span></div>${coverage === null ? '' : `<div class="cov">${coverage}</div>`}</div>
    <div class="cell"><div class="lbl">Catégorie</div><div class="val">${esc(data.category)}</div></div>
    <div class="cell"><div class="lbl">Campagnes incluses</div><div class="val">${castHasData ? String(data.campaignsBlock.count) : `<span class="wait">${PENDING}</span>`}</div></div>
  </div>`;

  // ── page 1 · cover ───────────────────────────────────────────────────────────────────────────
  const catParts = data.category.split(' · ');
  const coverSub =
    catParts.length === 2
      ? `<span class="cat">${esc(catParts[0] ?? '')}</span><span class="dot"></span><span class="cat">${esc(catParts[1] ?? '')}</span>`
      : `<span class="cat">${esc(data.category)}</span>`;
  const cover = `
<div class="page cover">
  <div class="cover__logo">${brandMark('cover__mark')}<span class="cover__word">tood<b>oo</b>h</span></div>
  <div class="cover__hero">
    <div class="cover__kicker">Rapport de performances</div>
    <div class="cover__title"><b>${esc(data.venueName)}</b></div>
    <div class="cover__sub">${coverSub}</div>
    <div class="cover__sub"><span class="cover__period">${period}</span></div>
  </div>
  ${metastrip}
  <div class="cover__generated">Généré le ${data.generatedLabel}</div>
  ${footer(1)}
</div>`;

  // ── S01 ──────────────────────────────────────────────────────────────────────────────────────
  const statNum = (value: number | null, unit?: string, size?: string): string => {
    if (value === null) return `<div class="stat-wait">${PENDING}</div>`;
    const suffix = unit ? ` <span class="unit">${unit}</span>` : '';
    const formatted = unit ? formatDecimalFr(value) : formatIntFr(value);
    return `<div class="stat-num"${size ? ` style="font-size:${size}"` : ''}>${formatted}${suffix}</div>`;
  };
  const s01 = `
  <div class="section" style="margin-top:26px">
    ${secHead('Section 01', 'Votre audience en chiffres', AUDIENCE_KPIS_LEAD)}
    <div class="statrow">
      <div class="col">
        <div class="stat-lbl">Audience globale</div>
        ${statNum(hostHasData ? kpis.global : null)}
        <div class="stat-desc">Personnes touchées dans votre lieu sur la période${
          // PERF-R1 — the provenance share replaces the « jours mesurés » caption.
          !hostHasData || kpis.estimatedPct === null || kpis.estimatedPct === 0
            ? '.'
            : kpis.estimatedPct === 100
              ? ' — 100 % estimation.'
              : ` — dont ${kpis.estimatedPct} % estimés.`
        }</div>
      </div>
      <div class="col">
        <div class="stat-lbl">Audience moyenne / heure</div>
        ${statNum(hostHasData ? (kpis.perHour ?? 0) : null, 'pers/h')}
        <div class="stat-desc">Densité moyenne d'audience pendant les heures d'ouverture.</div>
        <div class="stat-sub">
          <div class="stat-lbl">Audience moyenne / jour</div>
          ${statNum(hostHasData ? (kpis.perDay ?? 0) : null, undefined, '24pt')}
          <div class="stat-desc">Personnes par jour d'ouverture en moyenne.</div>
        </div>
      </div>
      <div class="col">
        <div class="stat-lbl">Pic d'audience</div>
        ${
          // US-P.4 — « — » when the sensor measured nothing on the period; the mockup's
          // JJ/MM/AAAA placeholder never renders (it read as a real date at a glance).
          hostHasData && !kpis.peak
            ? '<div class="stat-num">—</div>'
            : statNum(hostHasData ? (kpis.peak?.value ?? 0) : null)
        }
        <div class="stat-desc">${
          kpis.peak
            ? `Maximum observé le <span class="stat-hi">${formatDateFr(kpis.peak.date)}</span>`
            : 'Aucun maximum observé sur la période.'
        }</div>
      </div>
    </div>${
      hostHasData && kpis.measuredDays === 0 && kpis.estimatedPct === null
        ? `
    <div class="stat-desc" style="margin-top:14px">${NO_MEASURE_NOTE}</div>`
        : ''
    }
  </div>`;

  // ── S02 ──────────────────────────────────────────────────────────────────────────────────────
  const s02 = `
  <div class="section">
    ${secHead('Section 02', 'Vos peak hours', PEAK_HOURS_LEAD)}
    <div class="panel heat">${heatmapHtml(data.heatLevels, data.heatKinds, data.heatEmpty)}
    </div>
  </div>`;

  // ── S03 ──────────────────────────────────────────────────────────────────────────────────────
  const s03 = `
  <div class="section" style="margin-top:0">
    ${secHead('Section 03', 'Évolution des impressions', "Volume d'impressions servies dans votre lieu, jour par jour, sur la période analysée.")}
    <div class="panel">
      <div class="chartcard-head">
        <span class="t">Impressions par jour</span>
        <span class="s">Sur la période sélectionnée</span>
      </div>
      ${impressionsChartBlock(castHasData ? data.days : [])}
      <div class="chart-foot"><span class="line"></span>Impressions servies</div>
    </div>
  </div>`;

  // ── S04 ──────────────────────────────────────────────────────────────────────────────────────
  const demoPending = !hostHasData || data.breakdown === null;
  const b = data.breakdown;
  const sexeMax = b ? Math.max(b.femmes, b.hommes) : 0;
  const ageMax = b ? Math.max(...b.ages.map((band) => band.count)) : 0;
  const persValue = (count: number): string =>
    `<span class="val">${formatIntFr(count)} pers.</span>`;
  const waitValue = `<span class="val wait">${PENDING}</span>`;
  // MEJ-14a — pending draws the TRACK ONLY (demoBarPct returns 0); the mockup's decorative
  // widths are gone from both surfaces, which share the rule so they cannot disagree again.
  const sexeRow = (name: string, count: number): string =>
    barRow(
      name,
      demoPending ? waitValue : persValue(count),
      demoBarPct({ pending: demoPending, count, maxCount: sexeMax }),
    );
  const sexeRows = sexeRow('Femmes', b?.femmes ?? 0) + sexeRow('Hommes', b?.hommes ?? 0);
  // CLS-AGE1 — THREE bands since 03/09. This pending placeholder is its own copy of the band list
  // (the merged breakdown is null here, so there is nothing to map), which is exactly why it was
  // the site a label change would miss. MEJ-14a's empty-bars pin caught it.
  const ageBands = b?.ages ?? [
    { label: '17 – 30 ans', count: 0 },
    { label: '31 – 45 ans', count: 0 },
    { label: '46 ans et plus', count: 0 },
  ];
  const ageRows = ageBands
    .map((band) =>
      barRow(
        band.label,
        demoPending ? waitValue : persValue(band.count),
        demoBarPct({ pending: demoPending, count: band.count, maxCount: ageMax }),
      ),
    )
    .join('');
  const s04 = `
  <div class="section">
    ${secHead('Section 04', 'Profil typologique de votre clientèle', "Photographie typologique de l'audience qui fréquente votre lieu, établie à partir des mesures réalisées dans un établissement pilote de votre catégorie.")}
    <div class="callout">
      <b>Comment lire ce profil.</b> Les répartitions par sexe et tranche d'âge proviennent des mesures réalisées dans un lieu pilote représentatif de la catégorie « <span class="tag">${esc(data.category === '—' ? 'Catégorie de lieu' : data.category)}</span> ». Elles sont exprimées ici en nombre de personnes estimées, et non en pourcentage.
    </div>
    <div class="two-col">
      <div>
        <div class="bars-title">Répartition par sexe</div>${sexeRows}
      </div>
      <div>
        <div class="bars-title">Répartition par tranche d'âge</div>${ageRows}
      </div>
    </div>
  </div>`;

  // ── S05 ──────────────────────────────────────────────────────────────────────────────────────
  const revAmount = castHasData
    ? `<div class="rev-amount"><span class="ic">↻</span><span class="big">${data.revenue.totalLabel} <span class="cur">TND</span></span></div>`
    : `<div class="rev-amount"><span class="ic">↻</span><span class="big">À venir</span></div>
          <div class="rev-note">Vos premiers gains arrivent dès le lancement des campagnes.</div>`;
  const revCamp = castHasData
    ? `<div class="rev-camp"><span class="n">${data.revenue.count}</span> <span class="c">diffusées</span></div>`
    : `<div class="rev-camp"><span class="n">0</span> <span class="c">pour l'instant</span></div>`;
  const revBody = !castHasData
    ? `<div class="rev-banner"><b>Vos écrans sont prêts à recevoir nos annonceurs.</b> Conservez un score de priorité élevé pour capter les premiers budgets dès leur déploiement.</div>`
    : data.revenue.rows.length === 0
      ? `<div class="rev-rows">
        <div class="rev-rows-head"><span>Détail par campagne</span><span>Votre revenu</span></div>
        <div class="rev-empty">${NO_CAMPAIGN_IN_PERIOD}</div>
      </div>`
      : `<div class="rev-rows">
        <div class="rev-rows-head"><span>Détail par campagne</span><span>Votre revenu</span></div>
        ${data.revenue.rows
          .slice(0, REV_MAX_ROWS)
          .map(
            (row) =>
              `<div class="rev-row"><span class="n">${esc(row.name)}</span><span class="p">${esc(row.period)}</span><span class="a">${row.amountLabel}</span></div>`,
          )
          .join(
            '\n        ',
          )}${data.revenue.rows.length > REV_MAX_ROWS ? `\n        <div class="rev-more">+ ${data.revenue.rows.length - REV_MAX_ROWS} autres campagnes</div>` : ''}
      </div>`;
  const s05 = `
  <div class="section">
    ${secHead('Section 05', 'Vos revenus de la période', 'Voici le total de vos revenus pour la période analysée, avec le détail des campagnes qui les ont générés.')}
    <div class="rev-card">
      <div class="rev-head">
        <div>
          <div class="rev-lbl">Revenu cumulé</div>
          ${revAmount}
        </div>
        <div class="rev-camp-wrap">
          <div class="rev-lbl">Campagnes</div>
          ${revCamp}
        </div>
      </div>
      ${revBody}
      <div class="rev-foot">↻ Calculé sur les impressions effectivement servies dans votre lieu pendant chaque campagne</div>
    </div>
  </div>`;

  // ── S06 ──────────────────────────────────────────────────────────────────────────────────────
  const cb = data.campaignsBlock;
  const top3Rows = [0, 1, 2]
    .map((idx) => {
      const name = cb.top3[idx];
      return `<div class="row"><span class="rank">${idx + 1}</span><span class="name${name ? ' name--real' : ''}">${esc(name ?? 'Nom de la campagne')}</span></div>`;
    })
    .join('\n          ');
  const csCell = (label: string, value: string, desc: string): string => `
        <div class="c">
          <div class="cs-lbl">${label}</div>
          ${value}
          <div class="cs-desc">${desc}</div>
        </div>`;
  const histBlock = !castHasData
    ? `<div class="hist-empty">${PENDING}.</div>`
    : cb.rows.length === 0
      ? `<div class="hist-empty">${NO_CAMPAIGN_IN_PERIOD}</div>`
      : `<table class="hist">
        <thead><tr><th>Campagne</th><th>Période</th><th>Type</th><th>Statut</th><th>Impressions</th><th class="th-r">Revenu</th></tr></thead>
        <tbody>${cb.rows
          .slice(0, HIST_MAX_ROWS)
          .map(
            (row) =>
              `<tr><td class="td-name">${esc(row.name)}</td><td class="td-mono">${esc(row.period)}</td><td>${esc(row.typeLabel)}</td><td><span class="pill${row.statut === 'En cours' ? ' pill--active' : ''}"><span class="pd"></span>${esc(row.statut)}</span></td><td class="td-mono">${row.impressionsLabel}</td><td class="td-amt">${row.revenueLabel}</td></tr>`,
          )
          .join(
            '',
          )}${cb.rows.length > HIST_MAX_ROWS ? `<tr class="hist-more"><td colspan="6">+ ${cb.rows.length - HIST_MAX_ROWS} autres campagnes</td></tr>` : ''}</tbody>
      </table>`;
  const s06 = `
  <div class="section" style="margin-top:0">
    ${secHead('Section 06', 'Vos campagnes', 'Synthèse et historique des campagnes diffusées dans votre lieu sur la période analysée.')}
    <div style="margin-top:10px">
      <div class="sub-h">Vos campagnes en chiffres</div>
      <div class="sub-lead">Synthèse des campagnes diffusées dans votre lieu sur la période analysée.</div>
      <div class="camp-stats">${csCell(
        'Campagnes diffusées',
        castHasData
          ? `<div class="cs-num">${cb.count}</div>`
          : `<div class="cs-wait">${PENDING}</div>`,
        'Nombre de campagnes ayant tourné dans votre lieu sur la période',
      )}${csCell(
        'Impressions cumulées',
        castHasData
          ? `<div class="cs-num">${formatIntFr(cb.cumulativeImpressions)}</div>`
          : `<div class="cs-wait">${PENDING}</div>`,
        'Total des impressions servies sur la période analysée',
      )}
        <div class="c top3">
          <div class="cs-lbl">Top 3 campagnes</div>
          ${top3Rows}
        </div>
      </div>
    </div>
    <div style="margin-top:10px">
      <div class="sub-h">Historique des campagnes</div>
      <div class="sub-lead">Détail campagne par campagne sur la période analysée, avec leurs principaux indicateurs de performance.</div>
      ${histBlock}
    </div>
  </div>`;

  // ── S07 — the SAME generator the owner page reads (PERF-QA2) ─────────────────────────────────
  // EVERY body is esc()-aped, not just the AI one: the generator now composes bodies from data
  // (SPS labels/values), so the document escapes uniformly instead of trusting a constant.
  const pisteCard = (piste: {
    num: string;
    title: string;
    body: string;
    pending: boolean;
  }): string => `
    <div class="piste">
      <div class="piste-k"><span class="b"></span>Piste ${piste.num}</div>
      <div class="piste-t">${esc(piste.title)}</div>
      <div class="piste-body${piste.pending ? ' wait' : ''}">${esc(piste.body)}</div>
    </div>`;
  const pisteCards = buildPistes({
    events: data.upcomingEvents,
    sps: data.sps,
    aiBody: opts.aiPistes ?? null,
  })
    .map(pisteCard)
    .join('');
  const s07 = `
  <div class="section">
    ${secHead('Section 07', "Vos pistes d'optimisation futures", "Quelques observations issues de l'activité de votre lieu sur la période, transformées en pistes concrètes pour développer vos revenus.")}
    <div class="callout"><b>Lecture personnalisée.</b> Ces pistes s'appuient sur les données mesurées dans votre lieu - audience, profil typologique, performance des campagnes diffusées.</div>
    ${pisteCards}
  </div>`;

  // ── S08 — the SPS card (E4): the four ruled variables with their REAL values + the config
  // weights (40/30/20/10 by default). A null block (compute hiccup) keeps the wait-state — a
  // report never fails on the score. The Classement stays « À venir » (no ranking data yet).
  const fmtScore = (n: number): string =>
    Number.isInteger(n) ? String(n) : n.toFixed(1).replace('.', ',');
  const criteria = (
    data.sps?.criteria.map(
      (c) => [c.label, `poids ${fmtScore(c.weight)} %`, `${fmtScore(c.value)} / 100`] as const,
    ) ?? [
      ["Taux d'acceptation des campagnes", 'poids 40 %', 'À venir'] as const,
      ['Respect des événements acceptés', 'poids 30 %', 'À venir'] as const,
      ["Activité de l'écran", 'poids 20 %', 'À venir'] as const,
      ['Taux de remplissage', 'poids 10 %', 'À venir'] as const,
    ]
  )
    .map(
      ([name, weight, value]) =>
        `<div class="crit-row"><div class="crit-left"><span class="crit-name">${name}</span><span class="crit-weight">${weight}</span></div><span class="crit-val">${value}</span></div>`,
    )
    .join('\n        ');
  const s08 = `
  <div class="section" style="margin-top:0">
    ${secHead('Section 08', 'Votre score de priorité', 'Le score de priorité reflète votre engagement sur la plateforme. Plus il est élevé, plus vous êtes positionné en priorité quand de nouvelles campagnes sont à diffuser dans le réseau.')}
    <div class="score-hero">
      <div class="score-current">
        <div class="l">Score actuel</div>
        <div class="score-ring"><span class="v">${data.sps ? fmtScore(data.sps.score) : 'À venir'}</span></div>
      </div>
      <div class="score-crit">
        ${criteria}
      </div>
    </div>
    <div class="callout"><b>Comment lire votre score.</b> Votre score est mis à jour à chaque campagne ou événement. Votre score et votre classement sont strictement personnels - vous êtes le seul à pouvoir les consulter.</div>
    <div class="rank-card">
      <span class="l">Classement</span>
      <span class="v">À venir</span>
    </div>
  </div>`;

  // ── document ─────────────────────────────────────────────────────────────────────────────────
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<style>
@import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,500;0,9..144,600;1,9..144,400;1,9..144,500&family=Geist:wght@300;400;500;600;700;800&family=Geist+Mono:wght@400;500;600&display=swap');

:root{
  --paper:      #0D2B1F;   /* Toodooh deep green — dominant background */
  --paper-deep: #081D14;   /* deeper tone for gradients / footer */
  --card:       #103524;   /* raised panel */
  --card-soft:  #0F2E20;   /* subtle panel */
  --ink:        #EDF6EF;   /* primary text */
  --muted:      #9DB9A8;   /* secondary text */
  --faint:      #7A9686;   /* tertiary / captions */
  --line:       rgba(118,230,171,0.16);
  --line-soft:  rgba(118,230,171,0.08);
  --mint:       #76E6AB;   /* Algae green — accent */
  --accent:     #1D9E75;   /* accent green */

  --serif: 'Fraunces', Georgia, serif;
  --sans:  'Geist', -apple-system, system-ui, sans-serif;
  --mono:  'Geist Mono', 'SF Mono', Monaco, monospace;
}

*{ box-sizing:border-box; margin:0; padding:0; }
@page{ size:A4; margin:0; }
body{
  font-family:var(--sans);
  color:var(--ink);
  background:var(--paper-deep);
  -webkit-font-smoothing:antialiased;
  text-rendering:optimizeLegibility;
  line-height:1.48;
  -webkit-print-color-adjust:exact; print-color-adjust:exact;
}

/* ============ PAGE FRAME ============ */
.page{
  width:210mm;
  height:297mm;
  overflow:hidden;
  margin:0 auto;
  position:relative;
  background:
    radial-gradient(120% 80% at 85% -10%, rgba(118,230,171,0.08) 0%, rgba(118,230,171,0) 55%),
    radial-gradient(90% 60% at -10% 110%, rgba(29,158,117,0.10) 0%, rgba(29,158,117,0) 55%),
    var(--paper);
  padding:15mm 16mm 13mm;
  display:flex;
  flex-direction:column;
}
.page + .page{ margin-top:8mm; }

@media print{
  body{ background:var(--paper); }
  .page{ margin:0 !important; box-shadow:none; page-break-after:always; }
  .page:last-child{ page-break-after:auto; }
}

/* ============ RUNNING HEADER / FOOTER ============ */
.runhead{
  position:absolute; top:9mm; right:18mm;
  font-family:var(--mono); font-size:7.5pt; letter-spacing:.06em;
  color:var(--faint);
}
.footer{
  margin-top:auto;
  padding-top:6mm;
  display:flex; align-items:center; justify-content:space-between;
  border-top:1px solid var(--line-soft);
}
.footer__brand{ display:flex; align-items:center; gap:7px; }
.footer__brand span{
  font-family:var(--mono); font-size:6.5pt; letter-spacing:.22em;
  color:var(--faint); text-transform:uppercase;
}
.footer__mark{ height:9px; width:11px; color:var(--mint); opacity:.9; }
.footer__word{ font-family:var(--sans) !important; font-size:8.5pt !important; font-weight:600;
  letter-spacing:-.01em !important; color:var(--ink) !important; text-transform:none !important; }
.footer__word b{ color:var(--mint); font-weight:600; }
.footer__page{
  font-family:var(--mono); font-size:7.5pt; letter-spacing:.08em; color:var(--faint);
}

/* ============ COVER ============ */
.cover{ justify-content:flex-start; }
.cover__logo{ display:flex; align-items:center; gap:9px; }
.cover__mark{ height:18px; width:22px; color:var(--mint); }
.cover__word{ font-size:13.5pt; font-weight:600; letter-spacing:-.01em; color:var(--ink); }
.cover__word b{ color:var(--mint); font-weight:600; }
.cover__hero{ margin-top:auto; margin-bottom:auto; }
.cover__kicker{
  font-family:var(--mono); font-size:8.5pt; letter-spacing:.42em;
  color:var(--mint); text-transform:uppercase; margin-bottom:22px;
}
.cover__title{
  font-family:var(--serif); font-style:italic; font-weight:400;
  font-size:64pt; line-height:.98; letter-spacing:-.01em; color:var(--ink);
}
.cover__title b{ font-style:normal; font-weight:500; }
.cover__sub{
  margin-top:20px; display:flex; align-items:center; gap:14px;
  font-size:14pt; color:var(--muted);
}
.cover__sub .cat{ color:var(--mint); font-weight:500; }
.cover__sub .dot{ width:4px; height:4px; border-radius:50%; background:var(--faint); }
.cover__period{ font-family:var(--mono); font-size:11pt; letter-spacing:.02em; }

.metastrip{
  display:grid; grid-template-columns:repeat(4,1fr); gap:0;
  border-top:1px solid var(--line); border-bottom:1px solid var(--line);
}
.metastrip .cell{ padding:13px 20px 13px 0; border-left:1px solid var(--line-soft); padding-left:20px; }
.metastrip .cell:first-child{ border-left:none; padding-left:0; }
.metastrip .lbl{
  font-family:var(--mono); font-size:6.8pt; letter-spacing:.2em; text-transform:uppercase;
  color:var(--faint); margin-bottom:7px;
}
.metastrip .val{ font-family:var(--mono); font-size:9.5pt; color:var(--ink); }
.metastrip .val .accent{ color:var(--mint); }
.metastrip .val .wait{ color:var(--muted); }

.cover__generated{
  margin-top:14px; font-family:var(--mono); font-size:8pt; letter-spacing:.04em; color:var(--faint);
}

/* ============ SECTION ============ */
/* print-fit pass: the mockup's spacing was authored on the EMPTY state (its own fit strategy was
   the rejected transform-scale script) — margins/densities below are tightened so the ruled row
   caps fit the fixed pages in DATA states. Sizes/palette/structure untouched. */
.section{ margin-top:11px; }
.section:first-of-type{ margin-top:0; }
.sec-kicker{
  display:flex; align-items:center; gap:8px;
  font-family:var(--mono); font-size:7.5pt; letter-spacing:.24em; text-transform:uppercase;
  color:var(--mint); margin-bottom:8px;
}
.sec-kicker .bullet{ width:6px; height:6px; border-radius:50%; background:var(--mint); box-shadow:0 0 0 3px rgba(118,230,171,0.15); }
.sec-title{ font-size:17pt; font-weight:700; letter-spacing:-.02em; color:var(--ink); margin-bottom:4px; }
.sec-lead{ font-size:9pt; color:var(--muted); max-width:72ch; }

/* ============ STAT ROW (Section 01) ============ */
.statrow{
  margin-top:12px;
  display:grid; grid-template-columns:1.05fr 1.25fr 1fr;
  border-top:2px solid var(--mint);
  background:linear-gradient(180deg, rgba(118,230,171,0.04), rgba(118,230,171,0));
  border-radius:0 0 6px 6px;
}
.statrow .col{ padding:14px 20px; border-left:1px solid var(--line-soft); }
.statrow .col:first-child{ border-left:none; }
.stat-lbl{
  font-family:var(--mono); font-size:6.8pt; letter-spacing:.18em; text-transform:uppercase;
  color:var(--faint); margin-bottom:10px; display:flex; align-items:center; gap:6px;
}
.stat-lbl::before{ content:""; width:4px; height:4px; border-radius:50%; background:var(--mint); }
.stat-num{ font-size:30pt; font-weight:700; letter-spacing:-.03em; color:var(--ink); line-height:1; }
.stat-num .unit{ font-size:12pt; font-weight:400; color:var(--muted); letter-spacing:0; }
.stat-wait{ font-family:var(--serif); font-style:italic; font-size:11.5pt; color:var(--muted); line-height:1.2; }
.cov{ font-family:var(--mono); font-size:7.5pt; color:var(--faint); margin-top:5px; letter-spacing:.01em; }
.stat-desc{ font-size:8.5pt; color:var(--muted); margin-top:8px; max-width:34ch; }
.stat-sub{ margin-top:11px; padding-top:11px; border-top:1px solid var(--line-soft); }
.stat-hi{ color:var(--mint); font-family:var(--mono); font-size:8.5pt; }

/* ============ HEATMAP (Section 02) ============ */
.panel{
  margin-top:12px; background:var(--card); border:1px solid var(--line);
  border-radius:10px; padding:12px 18px;
}
.heat{ width:100%; }
/* Slice C — 28 half-hour columns; the hour labels span two each. Tighter gap so 28 cells still
   read as a week rather than a barcode. */
.heat-grid{ display:grid; grid-template-columns:34px repeat(28, 1fr); gap:2px; }
.heat-hspan{ grid-column:span 2; }
.heat-hlabel, .heat-dlabel{
  font-family:var(--mono); font-size:6.5pt; letter-spacing:.05em; color:var(--faint);
  display:flex; align-items:center;
}
.heat-hlabel{ justify-content:center; padding-bottom:4px; }
.heat-dlabel{ justify-content:flex-start; }
.heat-cell{ aspect-ratio:0.62/1; border-radius:2px; }
.h0{ background:rgba(118,230,171,0.06); }
.h1{ background:rgba(118,230,171,0.14); }
.h2{ background:rgba(118,230,171,0.30); }
.h3{ background:rgba(118,230,171,0.55); }
.h4{ background:var(--mint); }
.hclosed{
  background:
    repeating-linear-gradient(45deg, rgba(157,185,168,0.14) 0 3px, transparent 3px 6px),
    rgba(255,255,255,0.015);
}
/* AFF1 — estimation treatment layered over a ramp level: lighter + a near-white dashed outline
   (print-safe; a mist-toned outline vanished on the bright levels — measured on the P2 render). */
/* S02-SRC1 — the estimation signal is a low-density diagonal HATCH drawn ON the ramp colour, plus
   the dashed outline. A wash (opacity) failed at the light end and a bare outline failed at the
   dark end — both rely on something a half-width cell cannot show. Twin of the page's
   HEATMAP_ESTIMATION_CLASS; the dense hachure stays reserved for closed / no-data. */
.hest{
  background-image:repeating-linear-gradient(-45deg,transparent,transparent 2px,rgba(237,246,239,0.55) 2px,rgba(237,246,239,0.55) 3.5px);
  outline:1.5px dashed rgba(242,247,244,0.9); outline-offset:-2px;
}
.heat-legend{
  margin-top:16px; display:flex; align-items:center; gap:8px; flex-wrap:nowrap; white-space:nowrap;
  font-family:var(--mono); font-size:6.8pt; letter-spacing:.14em; text-transform:uppercase; color:var(--faint);
}
.heat-legend .swatch{ width:14px; height:11px; border-radius:2px; flex:0 0 auto; }
.heat-legend .sep{ width:1px; height:11px; background:var(--line); margin:0 4px; flex:0 0 auto; }
.heat-empty{
  min-height:112px; display:flex; flex-direction:column; align-items:center; justify-content:center;
  text-align:center; border:1px dashed var(--line); border-radius:8px; padding:12px 24px;
}
.heat-empty .t{ font-size:10pt; font-weight:600; color:var(--ink); }
.heat-empty .s{ margin-top:4px; font-size:8pt; color:var(--faint); max-width:420px; }

/* ============ CHART (Section 03) ============ */
/* R3 — labeled axes (Mejri item 4, overrides the axis-less mockup). The former 62px chart
   absorbs the 11px date row internally (50px plot + 11px labels) so page 3's slack holds. */
.chartcard-head{ display:flex; align-items:baseline; justify-content:space-between; margin-bottom:10px; }
.chartcard-head .t{ font-size:11pt; font-weight:600; color:var(--ink); }
.chartcard-head .s{ font-family:var(--mono); font-size:7.5pt; letter-spacing:.08em; color:var(--faint); }
.chartfig{ display:grid; grid-template-columns:30px 1fr; grid-template-rows:50px 11px; column-gap:8px; }
.chart-ylab{ grid-column:1; grid-row:1; position:relative; }
.chart-ylab span{
  position:absolute; right:0; transform:translateY(-50%);
  font-family:var(--mono); font-size:6.5pt; letter-spacing:.04em; color:var(--faint);
}
.chart-plot{ grid-column:2; grid-row:1; }
.chart-xlab{ grid-column:2; grid-row:2; position:relative; }
.chart-xlab span{
  position:absolute; top:3px; transform:translateX(-50%);
  font-family:var(--mono); font-size:6.5pt; letter-spacing:.04em; color:var(--faint);
}
.s03-chart{ width:100%; height:50px; display:block; border-radius:8px; }
.chart-empty{
  position:relative; height:50px; border-radius:8px;
  background:
    repeating-linear-gradient(90deg, var(--line-soft) 0 1px, transparent 1px 60px),
    rgba(255,255,255,0.012);
  display:flex; align-items:center; justify-content:center;
}
.s03-axes{ position:absolute; inset:0; width:100%; height:100%; }
.chart-empty span{ position:relative; font-family:var(--serif); font-style:italic; font-size:10.5pt; color:var(--faint); }
.chart-foot{
  margin-top:10px; display:flex; align-items:center; gap:8px;
  font-family:var(--mono); font-size:6.8pt; letter-spacing:.16em; text-transform:uppercase; color:var(--faint);
}
.chart-foot .line{ width:16px; height:2px; background:var(--mint); border-radius:2px; }

/* ============ CALLOUT ============ */
.callout{
  margin-top:8px; background:rgba(118,230,171,0.06); border-left:2px solid var(--mint);
  border-radius:0 8px 8px 0; padding:9px 14px; font-size:8.8pt; color:var(--muted); line-height:1.42;
}
.callout b{ color:var(--ink); font-weight:600; }
.callout .tag{ color:var(--mint); font-family:var(--mono); font-size:8pt; }

/* ============ PROFILE BARS (Section 04) ============ */
.two-col{ margin-top:8px; display:grid; grid-template-columns:1fr 1fr; gap:24px; }
.bars-title{
  font-family:var(--mono); font-size:6.8pt; letter-spacing:.18em; text-transform:uppercase;
  color:var(--faint); margin-bottom:9px; padding-bottom:7px; border-bottom:1px solid var(--line-soft);
}
.bar-row{ margin-bottom:6px; }
.bar-top{ display:flex; justify-content:space-between; align-items:baseline; margin-bottom:5px; }
.bar-top .name{ font-size:9pt; color:var(--ink); }
.bar-top .val{ font-family:var(--mono); font-size:8.5pt; color:var(--mint); }
.bar-top .val.wait{ font-family:var(--serif); font-style:italic; font-size:8.5pt; color:var(--faint); }
.bar-track{ height:6px; border-radius:4px; background:rgba(255,255,255,0.04); overflow:hidden; }
.bar-fill{ height:100%; border-radius:4px; background:linear-gradient(90deg, var(--accent), var(--mint)); }

/* ============ REVENUE (Section 05) ============ */
.rev-card{
  margin-top:12px; background:var(--card); border:1px solid var(--line); border-radius:10px;
  padding:12px 18px;
}
.rev-head{ display:flex; align-items:flex-start; justify-content:space-between; }
.rev-lbl{ font-family:var(--mono); font-size:6.8pt; letter-spacing:.18em; text-transform:uppercase; color:var(--faint); margin-bottom:8px; }
.rev-amount{ display:flex; align-items:center; gap:12px; }
.rev-amount .ic{
  width:26px; height:26px; border-radius:50%; background:rgba(118,230,171,0.10);
  display:flex; align-items:center; justify-content:center; color:var(--mint); font-size:12pt;
}
.rev-amount .big{ font-family:var(--serif); font-style:italic; font-size:26pt; color:var(--ink); font-weight:500; }
.rev-amount .cur{ font-family:var(--sans); font-style:normal; font-size:10.5pt; color:var(--muted); font-weight:400; }
.rev-note{ margin-top:6px; font-size:8.5pt; color:var(--faint); }
.rev-camp-wrap{ text-align:right; }
.rev-camp .n{ font-size:19pt; font-weight:700; color:var(--ink); }
.rev-camp .c{ font-size:8.5pt; color:var(--muted); }
.rev-banner{
  margin-top:12px; padding-top:12px; border-top:1px solid var(--line-soft);
  font-size:9pt; color:var(--muted);
}
.rev-banner b{ color:var(--mint); font-weight:600; }
.rev-rows{ margin-top:7px; padding-top:7px; border-top:1px solid var(--line-soft); }
.rev-rows-head{ display:flex; justify-content:space-between; font-family:var(--mono); font-size:6.5pt;
  letter-spacing:.16em; text-transform:uppercase; color:var(--faint); margin-bottom:3px; }
.rev-row{ display:grid; grid-template-columns:1fr auto auto; gap:14px; align-items:baseline;
  padding:4px 0; border-bottom:1px solid var(--line-soft); }
.rev-row:last-child{ border-bottom:none; }
.rev-row .n{ font-size:9pt; color:var(--ink); }
.rev-row .p{ font-family:var(--mono); font-size:7.5pt; color:var(--faint); }
.rev-row .a{ font-family:var(--mono); font-size:8.5pt; color:var(--mint); }
.rev-more{ padding-top:6px; font-family:var(--mono); font-size:7.5pt; color:var(--faint); }
.rev-empty{ padding:10px 0 4px; text-align:center; font-family:var(--serif); font-style:italic;
  font-size:10pt; color:var(--faint); }
.rev-foot{ margin-top:8px; display:flex; align-items:center; gap:8px; font-family:var(--mono); font-size:6.8pt; letter-spacing:.06em; color:var(--faint); }

/* ============ CAMPAIGNS (Section 06) ============ */
.sub-h{ font-size:12pt; font-weight:600; color:var(--ink); margin-bottom:3px; }
.sub-lead{ font-size:9pt; color:var(--muted); margin-bottom:7px; }
.camp-stats{
  display:grid; grid-template-columns:1fr 1fr 1fr; border-top:1px solid var(--line);
}
.camp-stats .c{ padding:8px 16px; border-left:1px solid var(--line-soft); }
.camp-stats .c:first-child{ border-left:none; padding-left:0; }
.cs-lbl{ font-family:var(--mono); font-size:6.5pt; letter-spacing:.16em; text-transform:uppercase; color:var(--faint); margin-bottom:8px; display:flex; align-items:center; gap:6px; }
.cs-lbl::before{ content:""; width:4px; height:4px; border-radius:50%; background:var(--mint); }
.cs-wait{ font-family:var(--serif); font-style:italic; font-size:11.5pt; color:var(--muted); }
.cs-num{ font-size:22pt; font-weight:700; letter-spacing:-.02em; color:var(--ink); line-height:1; }
.cs-desc{ font-size:8pt; color:var(--faint); margin-top:5px; }
.top3 .row{ display:flex; gap:10px; align-items:baseline; padding:2px 0 1px; }
.top3 .rank{ font-family:var(--mono); font-weight:600; color:var(--mint); font-size:9.5pt; width:14px; }
.top3 .name{ font-family:var(--mono); font-size:8.5pt; color:var(--faint); }
.top3 .name--real{ color:var(--ink); }
.hist-empty{
  margin-top:11px; border:1px dashed var(--line); border-radius:8px; padding:22px;
  text-align:center; font-family:var(--serif); font-style:italic; font-size:10.5pt; color:var(--faint);
}
.hist{ width:100%; border-collapse:collapse; margin-top:8px; font-size:7.5pt; }
.hist th{ text-align:left; font-family:var(--mono); font-size:6.5pt; letter-spacing:.16em;
  text-transform:uppercase; color:var(--faint); font-weight:600; padding:0 8px 4px 0;
  border-bottom:1px solid var(--line); }
.hist th.th-r{ text-align:right; padding-right:0; }
.hist td{ padding:3px 8px 3px 0; border-bottom:1px solid var(--line-soft); color:var(--muted); vertical-align:middle; }
.hist td.td-name{ color:var(--ink); }
.hist td.td-mono{ font-family:var(--mono); font-size:7pt; }
.hist td.td-amt{ font-family:var(--mono); text-align:right; padding-right:0; color:var(--mint); }
.hist tbody tr:last-child td{ border-bottom:none; }
.hist .pill{ display:inline-flex; align-items:center; gap:5px; font-family:var(--mono); font-size:7pt; color:var(--muted); }
.hist .pill .pd{ width:4px; height:4px; border-radius:50%; background:var(--faint); display:inline-block; }
.hist .pill--active{ color:var(--mint); }
.hist .pill--active .pd{ background:var(--mint); }
.hist-more td{ font-family:var(--mono); font-size:7.5pt; color:var(--faint); padding-top:5px; }

/* ============ PISTES (Section 07) ============ */
.piste{
  margin-top:8px; background:var(--card-soft); border:1px solid var(--line-soft);
  border-radius:9px; padding:7px 14px;
}
.piste-k{ font-family:var(--mono); font-size:7pt; letter-spacing:.2em; text-transform:uppercase; color:var(--mint); margin-bottom:5px; display:flex; align-items:center; gap:7px; }
.piste-k .b{ width:5px; height:5px; border-radius:50%; background:var(--mint); }
.piste-t{ font-size:11pt; font-weight:600; color:var(--ink); margin-bottom:3px; }
.piste-body{ font-size:9pt; color:var(--muted); line-height:1.42; }
.piste-body.wait{ font-family:var(--serif); font-style:italic; color:var(--faint); }

/* ============ SPS SCORE (Section 08) ============ */
.score-hero{
  margin-top:12px; display:grid; grid-template-columns:auto 1fr; gap:30px; align-items:start;
  background:var(--card); border:1px solid var(--line); border-radius:12px; padding:20px 24px;
}
.score-current .l{ font-family:var(--mono); font-size:6.8pt; letter-spacing:.2em; text-transform:uppercase; color:var(--faint); margin-bottom:10px; }
.score-ring{
  width:130px; height:130px; border-radius:50%;
  background:conic-gradient(rgba(118,230,171,0.10) 0turn, rgba(118,230,171,0.10) 1turn);
  border:6px solid rgba(118,230,171,0.10);
  display:flex; align-items:center; justify-content:center;
}
.score-ring .v{ font-family:var(--serif); font-style:italic; font-size:15pt; color:var(--muted); }
.score-crit .crit-row{ display:flex; align-items:center; justify-content:space-between; padding:11px 0; border-bottom:1px solid var(--line-soft); }
.score-crit .crit-row:last-child{ border-bottom:none; }
.crit-left{ display:flex; align-items:baseline; gap:12px; }
.crit-name{ font-size:9.5pt; color:var(--ink); }
.crit-weight{ font-family:var(--mono); font-size:7pt; letter-spacing:.06em; color:var(--faint); border:1px solid var(--line); border-radius:20px; padding:2px 9px; }
.crit-val{ font-family:var(--serif); font-style:italic; font-size:9.5pt; color:var(--muted); }
.rank-card{
  margin-top:12px; display:flex; align-items:center; justify-content:space-between;
  background:rgba(118,230,171,0.05); border:1px solid var(--line-soft); border-radius:10px; padding:16px 22px;
}
.rank-card .l{ font-family:var(--mono); font-size:6.8pt; letter-spacing:.2em; text-transform:uppercase; color:var(--faint); }
.rank-card .v{ font-family:var(--serif); font-style:italic; font-size:16pt; color:var(--muted); }
</style>
</head>
<body>
${cover}

<div class="page">${runhead}
  ${metastrip}
  ${s01}
  ${s02}
  ${footer(2)}
</div>

<div class="page">${runhead}
  ${s03}
  ${s04}
  ${s05}
  ${footer(3)}
</div>

<div class="page">${runhead}
  ${s06}
  ${s07}
  ${footer(4)}
</div>

<div class="page">${runhead}
  ${s08}
  ${footer(5)}
</div>
</body>
</html>`;
}
