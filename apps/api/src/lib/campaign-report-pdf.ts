import type { AnalysisSections, ClosedCampaign, ShareRow } from './advertiser-performances.js';
import {
  docBars,
  docKpis,
  docNote,
  docSection,
  docSubhead,
  renderDocHtml,
} from './pdf-doc/document.js';
import { renderPdf } from './report/render.js';

// SC-P (Annexe A Q4, working hypothesis) — the per-campaign « rapport de clôture »: sections 01–04
// of the analysis for ONE campaign, as a PDF. Operator 2026-10-09: chromium-rendered in the
// report's charter; the HTML builder is pure, so the confidentiality sweep asserts on it what the
// file does NOT contain (RG-PERF-31: no CPM, no SPS, no indice d'attention, no
// split key). Section 05 « Analyses et recommandations » is OUT (Mejri). Every montant is HT with
// HT without letters (HT-1, supersedes RG-PERF-30's TTC parentheses); « personnes touchées » never appears (RG-PERF-04).

const fmtInt = (n: number): string => Math.round(n).toLocaleString('fr-FR');
const fmtMoney = (n: number): string =>
  n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (iso: string | null): string => {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};
const fmtPct = (pct: number): string => `${pct.toLocaleString('fr-FR')} %`;

/**
 * HT-1 (operator, 2026-10-02, ruling 2A) — the screencaster sees every amount HT WITHOUT the
 * HT/TTC letters, and this report is not a payment document: « 1 000,00 TND ».
 */
export const tndLine = (ht: number): string => `${fmtMoney(ht)} TND`;

export const natureLabel = (nature: 'normal' | 'event'): string =>
  nature === 'event' ? 'Campagne événement' : 'Campagne normale';

export interface CampaignReportData {
  campaign: ClosedCampaign;
  sections: AnalysisSections;
  advertiserName: string;
  generatedAt: Date;
}

export const campaignReportFilename = (campaign: { name: string; closedOn: string }): string => {
  const slug =
    campaign.name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'campagne';
  return `rapport-${slug}-${campaign.closedOn}.pdf`;
};

/** Share rows → report bars: ratio against the largest, « label — peu couverte » below the floor. */
const shareBars = (rows: readonly ShareRow[], unit: string, flagBelowPct?: number): string => {
  if (rows.length === 0) return docNote('Aucune impression générée.');
  const max = Math.max(1, ...rows.map((r) => r.value));
  return docBars(
    rows.map((r) => {
      const low = flagBelowPct !== undefined && r.pct < flagBelowPct;
      return {
        label: low ? `${r.label} — peu couverte` : r.label,
        value: `${fmtPct(r.pct)}  ·  ${fmtInt(r.value)}${unit ? ` ${unit}` : ''}`,
        ratio: r.value / max,
        low,
      };
    }),
  );
};

/**
 * The rapport de clôture's HTML — operator 2026-10-09: the screenhost report's charter AS IS (deep
 * green paper, Geist/Fraunces, kicker sections) with the real logo (lib/pdf-doc). Content and
 * confidentiality unchanged (RG-PERF-31 / RG-PERF-04; amounts HT without letters, HT-1).
 */
export const buildCampaignReportHtml = (data: CampaignReportData): string => {
  const { campaign: c, sections: s } = data;
  const audience =
    s.audience === null
      ? docNote('Aucune impression générée.')
      : docSubhead('Par sexe') +
        shareBars(s.audience.sex, '') +
        docSubhead("Par tranche d'âge") +
        shareBars(s.audience.age, '') +
        (s.audience.unprofiledImpressions > 0
          ? docNote(
              `${fmtInt(s.audience.unprofiledImpressions)} impressions générées dans ${s.audience.unprofiledVenues} établissement(s) sans profil d'audience renseigné ne sont pas ventilées.`,
            )
          : '');
  return renderDocHtml({
    paper: 'dark',
    kicker: 'Rapport de clôture',
    title: c.name,
    meta: [
      { label: 'Annonceur', value: data.advertiserName },
      { label: 'Nature', value: natureLabel(c.nature) },
      { label: 'Diffusion', value: `${fmtDate(c.startDate)} → ${fmtDate(c.endDate)}` },
      { label: 'Clôturée le', value: fmtDate(c.closedOn) },
      { label: 'Généré le', value: fmtDate(data.generatedAt.toISOString().slice(0, 10)) },
    ],
    // Two fixed sheets, the screenhost report's layout: 01–02, then 03–04.
    body: [
      docSection(
        'Section 01',
        "Vue d'ensemble",
        'Les indicateurs clés atteints par cette campagne.',
        docKpis([
          { label: 'Impressions générées', value: fmtInt(c.impressions) },
          { label: 'Heures de diffusion', value: `${fmtInt(c.hours)} h` },
          { label: 'Diffusions du spot', value: fmtInt(c.plays) },
        ]) +
          docKpis([
            { label: 'Établissements diffuseurs', value: fmtInt(c.venues) },
            { label: 'Budget investi', value: tndLine(c.budgetHt) },
          ]),
      ) +
        docSection(
          'Section 02',
          'Répartition par catégorie de lieu',
          "La part de vos impressions générées selon le type d'établissement diffuseur.",
          shareBars(s.categories, 'impr.'),
        ),
      docSection(
        'Section 03',
        "Profil de l'audience et niveau CSP",
        "Le niveau de gamme des lieux diffuseurs, et la composition de l'audience mesurée dans ces lieux pendant la diffusion — sans identifier aucune personne.",
        docSubhead('Par niveau CSP') +
          shareBars(s.csp, 'impr.') +
          docSubhead('Audience mesurée dans les lieux') +
          audience,
      ) +
        docSection(
          'Section 04',
          'Répartition par zone géographique',
          'La couverture de vos impressions sur le Grand Tunis. Les zones peu ou pas couvertes sont signalées.',
          shareBars(s.zones, 'impressions', 5),
        ),
    ],
    footerNote: 'Mes performances · montants hors taxes',
  });
};

/** On the fly, per download — the report's chromium pipeline (lib/report/render). */
export const renderCampaignReportPdf = (data: CampaignReportData): Promise<Buffer> =>
  renderPdf(buildCampaignReportHtml(data));
