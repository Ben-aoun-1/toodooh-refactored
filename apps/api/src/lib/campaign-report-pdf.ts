import type { AnalysisSections, ClosedCampaign, ShareRow } from './advertiser-performances.js';
import { FEATURE_FLAGS } from './feature-flags.js';
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
/** The report's sections, in order. */
const REPORT_SECTIONS = ['overview', 'categories', 'audience', 'zones'] as const;

/**
 * « Section 0N » for each VISIBLE section under the flags — numbered without a gap. Twin of the
 * web's screencasterSectionNums (features/advertiser/lib/performances-derive.ts).
 */
export const campaignReportSectionNums = (
  flags: { screencasterPerfCategories: boolean; screencasterPerfZones: boolean } = FEATURE_FLAGS,
): Partial<Record<(typeof REPORT_SECTIONS)[number], string>> =>
  Object.fromEntries(
    REPORT_SECTIONS.filter(
      (k) =>
        (k !== 'categories' || flags.screencasterPerfCategories) &&
        (k !== 'zones' || flags.screencasterPerfZones),
    ).map((k, i) => [k, `Section ${String(i + 1).padStart(2, '0')}`]),
  );

export const buildCampaignReportHtml = (data: CampaignReportData): string => {
  const { campaign: c, sections: s } = data;
  const nums = campaignReportSectionNums();
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
    // Two fixed sheets, the screenhost report's layout: 01–02, then 03–04. Flags (operator
    // 2026-10-12) hide « catégorie de lieu » and « zone géographique » and the CSP block; the
    // visible sections number without a gap, like the « Mes performances » page.
    body: [
      docSection(
        nums.overview ?? '',
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
        (nums.categories
          ? docSection(
              nums.categories,
              'Répartition par catégorie de lieu',
              "La part de vos impressions générées selon le type d'établissement diffuseur.",
              shareBars(s.categories, 'impr.'),
            )
          : ''),
      (FEATURE_FLAGS.cspLevel
        ? docSection(
            nums.audience ?? '',
            "Profil de l'audience et niveau CSP",
            "Le niveau de gamme des lieux diffuseurs, et la composition de l'audience mesurée dans ces lieux pendant la diffusion — sans identifier aucune personne.",
            docSubhead('Par niveau CSP') +
              shareBars(s.csp, 'impr.') +
              docSubhead('Audience mesurée dans les lieux') +
              audience,
          )
        : docSection(
            nums.audience ?? '',
            "Profil de l'audience",
            "La composition de l'audience mesurée dans les lieux diffuseurs pendant la diffusion — sans identifier aucune personne.",
            docSubhead('Audience mesurée dans les lieux') + audience,
          )) +
        (nums.zones
          ? docSection(
              nums.zones,
              'Répartition par zone géographique',
              'La couverture de vos impressions sur le Grand Tunis. Les zones peu ou pas couvertes sont signalées.',
              shareBars(s.zones, 'impressions', 5),
            )
          : ''),
    ],
    footerNote: 'Mes performances · montants hors taxes',
  });
};

/** On the fly, per download — the report's chromium pipeline (lib/report/render). */
export const renderCampaignReportPdf = (data: CampaignReportData): Promise<Buffer> =>
  renderPdf(buildCampaignReportHtml(data));
