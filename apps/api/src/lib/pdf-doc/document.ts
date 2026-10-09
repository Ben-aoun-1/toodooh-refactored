import { logoHtml } from './logo.js';

// Operator 2026-10-09 — every Toodooh document (screencaster AND screenhost, financial or report)
// follows the screenhost monthly report's charter (lib/report/template.ts): its palette (deep
// green #0D2B1F, Algae green #76E6AB, accent #1D9E75), its type system (Geist / Geist Mono /
// Fraunces) and its header/footer idiom — with the REAL logo (./logo.ts). ONE home for that
// charter on the document side; each document only supplies its content blocks. Rendered by the
// report's own chromium pipeline (lib/report/render.ts renderPdf).
//
// Two papers, ONE charter:
//   'dark'  — the report's deep-green page, as is (reports, read on screen);
//   'light' — the same charter on white paper under a deep-green header band, for documents
//             that are printed, signed or stamped (factures, bons de commande).

export type DocPaper = 'dark' | 'light';

export const esc = (value: string): string =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );

/** « 1234.50 TND » — the documents' literal money format (fixed 2 decimals, no grouping). */
export const docTnd = (amount: number): string => `${amount.toFixed(2)} TND`;

export interface DocMetaItem {
  label: string;
  value: string;
}

export interface DocPageInput {
  paper: DocPaper;
  /** The mono uppercase eyebrow above the title (« Facture », « Bon de commande »…). */
  kicker: string;
  /** The document title (the serif display line). */
  title: string;
  /** Reference / période / date… — the report's metastrip. */
  meta: DocMetaItem[];
  /**
   * The document's own HTML blocks (built with the helpers below). An ARRAY lays out fixed A4
   * sheets, the report's way (each sheet keeps its margins, a running header and « page x / N »);
   * a string is one flowing page (the financial documents).
   */
  body: string | string[];
  /** Overrides the default footer line. */
  footerNote?: string;
}

/** Two side-by-side party blocks (Émetteur / Client, Facturé à…). */
export const docParties = (
  parties: { label: string; name: string; lines?: string[] }[],
): string => `
  <div class="parties">
    ${parties
      .map(
        (p) => `
      <div class="party">
        <div class="eyebrow">${esc(p.label)}</div>
        <div class="party__name">${esc(p.name)}</div>
        ${(p.lines ?? []).map((l) => `<div class="party__line">${esc(l)}</div>`).join('')}
      </div>`,
      )
      .join('')}
  </div>`;

/** A designation/amount table. */
export const docLines = (
  head: { label: string; amount: string },
  rows: { label: string; amount: string }[],
): string => `
  <table class="lines">
    <thead><tr><th>${esc(head.label)}</th><th class="num">${esc(head.amount)}</th></tr></thead>
    <tbody>
      ${rows
        .map((r) => `<tr><td>${esc(r.label)}</td><td class="num">${esc(r.amount)}</td></tr>`)
        .join('')}
    </tbody>
  </table>`;

/** The money block: plain rows, then ONE highlighted total. */
export const docTotals = (
  rows: { label: string; amount: string }[],
  total: { label: string; amount: string },
): string => `
  <div class="totals">
    ${rows
      .map(
        (r) =>
          `<div class="totals__row"><span>${esc(r.label)}</span><span class="mono">${esc(r.amount)}</span></div>`,
      )
      .join('')}
    <div class="totals__total"><span>${esc(total.label)}</span><span class="mono">${esc(total.amount)}</span></div>
  </div>`;

/** A titled key/value card (bank coordinates…). */
export const docCard = (title: string, rows: DocMetaItem[]): string => `
  <div class="card">
    <div class="eyebrow">${esc(title)}</div>
    ${rows
      .map(
        (r) =>
          `<div class="card__row"><span class="card__label">${esc(r.label)}</span><span class="card__value mono">${esc(r.value)}</span></div>`,
      )
      .join('')}
  </div>`;

/** A note paragraph (consigne, settlement wording…). */
export const docNote = (text: string): string => `<p class="note">${esc(text)}</p>`;

/** The signature / stamp area of a document the client prints, signs and returns. */
export const docSignature = (title: string, mention: string): string => `
  <div class="sign">
    <div class="eyebrow">${esc(title)}</div>
    <p class="sign__mention">${esc(mention)}</p>
    <div class="sign__box"><span>Signature et cachet</span></div>
  </div>`;

/** A report section: the report's kicker bullet + title + lead, then its body. */
export const docSection = (num: string, title: string, lead: string, body: string): string => `
  <section class="sec">
    <div class="sec__kicker"><span class="bullet"></span>${esc(num.toUpperCase())}</div>
    <h2 class="sec__title">${esc(title)}</h2>
    <p class="sec__lead">${esc(lead)}</p>
    ${body}
  </section>`;

/** A row of KPI tiles. */
export const docKpis = (cells: { label: string; value: string }[]): string => `
  <div class="kpis" style="grid-template-columns:repeat(${cells.length},1fr)">
    ${cells
      .map(
        (c) =>
          `<div class="kpi"><div class="eyebrow">${esc(c.label)}</div><div class="kpi__value">${esc(c.value)}</div></div>`,
      )
      .join('')}
  </div>`;

/** Horizontal share bars (label · value, bar scaled to the largest). `low` greys a row out. */
export const docBars = (
  rows: { label: string; value: string; ratio: number; low?: boolean }[],
): string => `
  <div class="bars">
    ${rows
      .map(
        (r) => `
      <div class="bar${r.low ? ' bar--low' : ''}">
        <div class="bar__head"><span>${esc(r.label)}</span><span class="mono">${esc(r.value)}</span></div>
        <div class="bar__track"><div class="bar__fill" style="width:${Math.max(0, Math.min(1, r.ratio)) * 100}%"></div></div>
      </div>`,
      )
      .join('')}
  </div>`;

/** A small sub-heading inside a section. */
export const docSubhead = (text: string): string => `<h3 class="subhead">${esc(text)}</h3>`;

const DEFAULT_FOOTER = "Réseau d'affichage DOOH en Tunisie";

/** The whole self-contained HTML document, ready for renderPdf. */
export const renderDocHtml = (input: DocPageInput): string => {
  const onDark = input.paper === 'dark';
  const sheets = typeof input.body === 'string' ? [input.body] : input.body;
  const fixed = typeof input.body !== 'string';
  const footer = (n: number): string => `
    <footer class="footer">
      <div class="footer__brand"><span>Powered by</span>${logoHtml(onDark ? 'onDark' : 'onLight', 'footer__logo')}</div>
      <div class="footer__note">${esc(input.footerNote ?? DEFAULT_FOOTER)}${
        fixed ? ` · page ${n} / ${sheets.length}` : ''
      }</div>
    </footer>`;
  const band = `
    <header class="band">
      <div class="band__top">
        ${logoHtml('onDark', 'band__logo')}
        <div class="band__kicker">${esc(input.kicker.toUpperCase())}</div>
      </div>
      <h1 class="band__title">${esc(input.title)}</h1>
      <div class="metastrip">
        ${input.meta
          .map(
            (m) =>
              `<div class="metastrip__item"><div class="eyebrow">${esc(m.label)}</div><div class="val">${esc(m.value)}</div></div>`,
          )
          .join('')}
      </div>
    </header>`;
  // Sheets after the first carry the report's running header instead of the full band.
  const runhead = `
    <header class="runhead">
      ${logoHtml(onDark ? 'onDark' : 'onLight', 'runhead__logo')}
      <div class="runhead__title">${esc(input.kicker)} · ${esc(input.title)}</div>
    </header>`;
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<style>${DOC_CSS}</style>
</head>
<body class="paper-${input.paper}">
  ${sheets
    .map(
      (sheet, i) => `
  <section class="page${fixed ? ' page--fixed' : ''}">
    ${i === 0 ? band : runhead}
    <main class="content">${sheet}</main>
    ${footer(i + 1)}
  </section>`,
    )
    .join('')}
</body>
</html>`;
};

// The report's :root, verbatim tokens (lib/report/template.ts), plus the light-paper overrides.
const DOC_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,500;0,9..144,600;1,9..144,400;1,9..144,500&family=Geist:wght@300;400;500;600;700;800&family=Geist+Mono:wght@400;500;600&display=swap');
:root{
  --paper:#0D2B1F; --paper-deep:#081D14; --card:#103524; --card-soft:#0F2E20;
  --ink:#EDF6EF; --muted:#9DB9A8; --faint:#7A9686;
  --line:rgba(118,230,171,0.16); --line-soft:rgba(118,230,171,0.08);
  --mint:#76E6AB; --accent:#1D9E75;
  --serif:'Fraunces', Georgia, serif;
  --sans:'Geist', -apple-system, system-ui, sans-serif;
  --mono:'Geist Mono', 'SF Mono', Monaco, monospace;
}
.paper-light{
  --body-bg:#FFFFFF; --body-ink:#10251A; --body-muted:#5B6E63; --body-faint:#8A9E92;
  --body-line:#E3EAE5; --body-card:#F4F8F5; --body-total:#0D2B1F; --body-total-ink:#76E6AB;
}
.paper-dark{
  --body-bg:var(--paper); --body-ink:var(--ink); --body-muted:var(--muted); --body-faint:var(--faint);
  --body-line:var(--line); --body-card:var(--card); --body-total:var(--card-soft); --body-total-ink:var(--mint);
}
*{ box-sizing:border-box; margin:0; padding:0; }
@page{ size:A4; margin:0; }
body{
  font-family:var(--sans); color:var(--body-ink); background:var(--body-bg);
  -webkit-font-smoothing:antialiased; line-height:1.48;
  -webkit-print-color-adjust:exact; print-color-adjust:exact;
}
.mono{ font-family:var(--mono); }
html, body{ background:var(--body-bg); }
.page--fixed{ height:297mm; min-height:0; overflow:hidden; page-break-after:always; break-after:page; }
.page--fixed:last-child{ page-break-after:auto; break-after:auto; }
.runhead{
  margin:0 16mm; padding:12mm 0 5mm; display:flex; align-items:center; justify-content:space-between;
  border-bottom:1px solid var(--body-line);
}
.runhead__logo{ height:5mm; width:auto; display:block; }
.runhead__logo--text{ font-size:10pt; font-weight:600; }
.runhead__logo--text b{ color:var(--mint); }
.runhead__title{ font-family:var(--mono); font-size:7.5pt; letter-spacing:.06em; color:var(--body-faint); }
.page{
  width:210mm; min-height:297mm; position:relative;
  display:flex; flex-direction:column; background:var(--body-bg);
}
.paper-dark .page{
  background:
    radial-gradient(120% 80% at 85% -10%, rgba(118,230,171,0.08) 0%, rgba(118,230,171,0) 55%),
    radial-gradient(90% 60% at -10% 110%, rgba(29,158,117,0.10) 0%, rgba(29,158,117,0) 55%),
    var(--paper);
}

/* ── header band: the report's cover idiom ── */
.band{
  color:var(--ink); padding:15mm 16mm 9mm;
  background:
    radial-gradient(120% 140% at 90% -30%, rgba(118,230,171,0.14) 0%, rgba(118,230,171,0) 60%),
    var(--paper);
}
.paper-dark .band{ background:transparent; border-bottom:1px solid var(--line); }
.band__top{ display:flex; align-items:center; justify-content:space-between; }
.band__logo{ height:9mm; width:auto; display:block; }
.band__logo--text{ font-size:15pt; font-weight:600; color:var(--ink); }
.band__logo--text b{ color:var(--mint); font-weight:600; }
.band__kicker{
  font-family:var(--mono); font-size:8.5pt; letter-spacing:.42em;
  color:var(--mint); text-transform:uppercase;
}
.band__title{
  margin-top:11mm; font-family:var(--serif); font-style:italic; font-weight:400;
  font-size:26pt; line-height:1.1; letter-spacing:-.01em; color:var(--ink);
}
.metastrip{ display:flex; gap:12mm; margin-top:7mm; flex-wrap:wrap; }
.eyebrow{
  font-family:var(--mono); font-size:6.8pt; letter-spacing:.2em; text-transform:uppercase;
  color:var(--body-faint);
}
.band .eyebrow{ color:var(--faint); }
.metastrip .val{ font-family:var(--mono); font-size:9.5pt; color:var(--ink); margin-top:2px; }

/* ── content ── */
.content{ padding:10mm 16mm 0; display:flex; flex-direction:column; gap:8mm; }
.parties{ display:grid; grid-template-columns:1fr 1fr; gap:8mm; }
.party__name{ margin-top:4px; font-size:13pt; font-weight:600; letter-spacing:-.01em; }
.party__line{ font-size:9.5pt; color:var(--body-muted); }
.lines{ width:100%; border-collapse:collapse; }
.lines th{
  font-family:var(--mono); font-size:6.8pt; letter-spacing:.18em; text-transform:uppercase;
  color:var(--body-faint); font-weight:500; text-align:left;
  padding:0 0 3mm; border-bottom:1px solid var(--body-line);
}
.lines td{ padding:3.2mm 0; font-size:10.5pt; border-bottom:1px solid var(--body-line); }
.lines .num{ text-align:right; font-family:var(--mono); }
.totals{ margin-left:auto; width:92mm; display:flex; flex-direction:column; gap:2.4mm; }
.totals__row{ display:flex; justify-content:space-between; font-size:10pt; color:var(--body-muted); }
.totals__total{
  margin-top:1.5mm; display:flex; justify-content:space-between; align-items:baseline;
  padding:4mm 5mm; border-radius:3mm; background:var(--body-total); color:var(--ink);
  font-size:11pt; font-weight:600;
}
.totals__total .mono{ color:var(--body-total-ink); font-size:14pt; font-weight:600; }
.card{
  background:var(--body-card); border:1px solid var(--body-line); border-radius:3mm;
  padding:5mm 6mm; display:flex; flex-direction:column; gap:2mm;
}
.card .eyebrow{ margin-bottom:1mm; }
.card__row{ display:flex; gap:6mm; font-size:10pt; }
.card__label{ width:30mm; color:var(--body-muted); }
.note{ font-size:9pt; color:var(--body-muted); line-height:1.55; }
.sign{ display:flex; flex-direction:column; gap:2mm; break-inside:avoid; }
.sign__mention{ font-size:9.5pt; color:var(--body-muted); }
.sign__box{
  margin-top:2mm; width:85mm; height:32mm; border:1px dashed var(--body-faint); border-radius:3mm;
  display:flex; align-items:flex-end; padding:3mm 4mm;
}
.sign__box span{ font-family:var(--mono); font-size:6.8pt; letter-spacing:.18em; text-transform:uppercase; color:var(--body-faint); }

/* ── report sections (the report's .sec-* idiom) ── */
.sec{ break-inside:avoid-page; display:flex; flex-direction:column; gap:3mm; padding-top:2mm; }
.sec__kicker{
  display:flex; align-items:center; gap:6px;
  font-family:var(--mono); font-size:7.5pt; letter-spacing:.24em; text-transform:uppercase; color:var(--mint);
}
.paper-light .sec__kicker{ color:var(--accent); }
.bullet{ width:6px; height:6px; border-radius:50%; background:currentColor; display:inline-block; }
.sec__title{ font-size:17pt; font-weight:600; letter-spacing:-.015em; line-height:1.2; }
.sec__lead{ font-size:9.5pt; color:var(--body-muted); max-width:150mm; }
.subhead{ margin-top:2mm; font-size:10pt; font-weight:600; }
.kpis{ display:grid; gap:4mm; }
.kpi{ background:var(--body-card); border:1px solid var(--body-line); border-radius:3mm; padding:4mm 5mm; }
.kpi__value{ margin-top:2mm; font-size:17pt; font-weight:600; letter-spacing:-.01em; }
.bars{ display:flex; flex-direction:column; gap:3mm; }
.bar{ break-inside:avoid; }
.bar__head{ display:flex; justify-content:space-between; font-size:9.5pt; }
.bar__head .mono{ font-size:8.5pt; color:var(--body-muted); }
.bar__track{ margin-top:1.4mm; height:4px; border-radius:2px; background:var(--body-line); overflow:hidden; }
.bar__fill{ height:100%; background:var(--mint); border-radius:2px; }
.bar--low .bar__head{ color:var(--body-faint); font-style:italic; }
.bar--low .bar__fill{ background:var(--body-faint); }

/* ── footer: the report's « Powered by » line ── */
.footer{
  margin:auto 16mm 0; padding:6mm 0 12mm;
  display:flex; align-items:center; justify-content:space-between;
  border-top:1px solid var(--body-line);
}
.footer__brand{ display:flex; align-items:center; gap:7px; flex-shrink:0; white-space:nowrap; }
.footer__brand span{
  font-family:var(--mono); font-size:6.5pt; letter-spacing:.22em;
  color:var(--body-faint); text-transform:uppercase;
}
.footer__logo{ height:4mm; width:auto; display:block; }
.footer__logo--text{ font-size:8.5pt; font-weight:600; }
.footer__logo--text b{ color:var(--mint); }
.footer__note{ font-family:var(--mono); font-size:7.5pt; letter-spacing:.06em; color:var(--body-faint); text-align:right; margin-left:8mm; }
`;
