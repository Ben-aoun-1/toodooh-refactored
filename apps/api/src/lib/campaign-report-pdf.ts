import PDFDocument from 'pdfkit';

import type { AnalysisSections, ClosedCampaign, ShareRow } from './advertiser-performances.js';
import { BRAND, INK, MUTED, loadLogo } from './facture.js';

// SC-P (Annexe A Q4, working hypothesis) — the per-campaign « rapport de clôture »: sections 01–04
// of the analysis for ONE campaign, as a PDF. pdfkit, compress:false — the facture posture: light
// (no chromium in CI), rendered on the fly, and test-decodable so the confidentiality sweep can
// assert what the file does NOT contain (RG-PERF-31: no CPM, no SPS, no indice d'attention, no
// split key). Section 05 « Analyses et recommandations » is OUT (Mejri). Every montant is HT with
// TTC in parentheses (RG-PERF-30); « personnes touchées » never appears (RG-PERF-04).

const fmtInt = (n: number): string => Math.round(n).toLocaleString('fr-FR');
const fmtMoney = (n: number): string =>
  n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (iso: string | null): string => {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};
const fmtPct = (pct: number): string => `${pct.toLocaleString('fr-FR')} %`;

/** HT with the TTC in parentheses — the ONE advertiser-facing money convention. */
export const htTtcLine = (ht: number, ttc: number): string =>
  `${fmtMoney(ht)} TND HT (${fmtMoney(ttc)} TND TTC)`;

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

export const renderCampaignReportPdf = (data: CampaignReportData): Promise<Buffer> =>
  new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50, compress: false });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const left = doc.page.margins.left;
    const right = doc.page.width - doc.page.margins.right;
    const width = right - left;
    const bottom = doc.page.height - doc.page.margins.bottom;
    const { campaign: c, sections: s } = data;

    const ensureRoom = (needed: number): void => {
      if (doc.y + needed > bottom) doc.addPage();
    };

    // ── header ──────────────────────────────────────────────────────────────
    const logo = loadLogo();
    if (logo) doc.image(logo, left, 50, { width: 120 });
    else doc.fillColor(BRAND).font('Helvetica-Bold').fontSize(22).text('toodooh', left, 54);
    doc
      .fillColor(INK)
      .font('Helvetica-Bold')
      .fontSize(18)
      .text('Rapport de clôture de campagne', left, 52, { align: 'right' });
    doc
      .fillColor(MUTED)
      .font('Helvetica')
      .fontSize(9.5)
      .text(`Annonceur : ${data.advertiserName}`, left, 78, { align: 'right' })
      .text(`Généré le ${fmtDate(data.generatedAt.toISOString().slice(0, 10))}`, {
        align: 'right',
      });
    doc.moveTo(left, 118).lineTo(right, 118).lineWidth(2).strokeColor(BRAND).stroke();

    doc.fillColor(INK).font('Helvetica-Bold').fontSize(16).text(c.name, left, 134, { width });
    doc
      .fillColor(MUTED)
      .font('Helvetica')
      .fontSize(10)
      .text(
        `${natureLabel(c.nature)} · Diffusion du ${fmtDate(c.startDate)} au ${fmtDate(c.endDate)} · Clôturée le ${fmtDate(c.closedOn)}`,
        { width },
      );
    doc.moveDown(1.2);

    const sectionTitle = (num: string, title: string, lead: string): void => {
      ensureRoom(90);
      doc.fillColor(BRAND).font('Helvetica-Bold').fontSize(9).text(num.toUpperCase(), left, doc.y);
      doc
        .fillColor(INK)
        .font('Helvetica-Bold')
        .fontSize(14)
        .text(title, left, doc.y + 2);
      doc
        .fillColor(MUTED)
        .font('Helvetica')
        .fontSize(9.5)
        .text(lead, left, doc.y + 2, { width });
      doc.moveDown(0.8);
    };

    const kpiRow = (cells: { label: string; value: string; detail?: string }[]): void => {
      ensureRoom(64);
      const cellW = width / cells.length;
      const y = doc.y;
      cells.forEach((cell, i) => {
        const x = left + i * cellW;
        doc
          .fillColor(MUTED)
          .font('Helvetica')
          .fontSize(8.5)
          .text(cell.label, x, y, { width: cellW - 8 });
        doc
          .fillColor(INK)
          .font('Helvetica-Bold')
          .fontSize(15)
          .text(cell.value, x, y + 13, { width: cellW - 8 });
        if (cell.detail) {
          doc
            .fillColor(MUTED)
            .font('Helvetica')
            .fontSize(8)
            .text(cell.detail, x, y + 33, { width: cellW - 8 });
        }
      });
      doc.y = y + 50;
      doc.moveTo(left, doc.y).lineTo(right, doc.y).lineWidth(0.5).strokeColor('#E5E7EB').stroke();
      doc.moveDown(0.9);
    };

    const barRows = (rows: readonly ShareRow[], unit: string, flagBelowPct?: number): void => {
      const max = Math.max(1, ...rows.map((r) => r.value));
      for (const r of rows) {
        ensureRoom(26);
        const y = doc.y;
        const low = flagBelowPct !== undefined && r.pct < flagBelowPct;
        doc
          .fillColor(low ? MUTED : INK)
          .font(low ? 'Helvetica-Oblique' : 'Helvetica')
          .fontSize(9.5)
          .text(low ? `${r.label} — peu couverte` : r.label, left, y, { width: width * 0.55 });
        doc
          .fillColor(INK)
          .font('Helvetica-Bold')
          .fontSize(9.5)
          .text(`${fmtPct(r.pct)}  ·  ${fmtInt(r.value)} ${unit}`, left + width * 0.55, y, {
            width: width * 0.45,
            align: 'right',
          });
        const barY = y + 13;
        doc.rect(left, barY, width, 4).fillColor('#EEF0F3').fill();
        doc
          .rect(left, barY, (width * r.value) / max, 4)
          .fillColor(low ? '#C9CDD3' : BRAND)
          .fill();
        doc.y = barY + 11;
      }
      doc.moveDown(0.6);
    };

    // ── Section 01 — Vue d'ensemble ────────────────────────────────────────
    sectionTitle(
      'Section 01',
      "Vue d'ensemble",
      'Les indicateurs clés atteints par cette campagne.',
    );
    kpiRow([
      { label: 'Impressions générées', value: fmtInt(c.impressions) },
      { label: 'Heures de diffusion', value: `${fmtInt(c.hours)} h` },
      { label: 'Diffusions du spot', value: fmtInt(c.plays) },
    ]);
    kpiRow([
      { label: 'Établissements diffuseurs', value: fmtInt(c.venues) },
      {
        label: 'Budget investi',
        value: `${fmtMoney(c.budgetHt)} TND HT`,
        detail: `(${fmtMoney(c.budgetTtc)} TND TTC)`,
      },
    ]);

    // ── Section 02 — Répartition par catégorie de lieu ─────────────────────
    sectionTitle(
      'Section 02',
      'Répartition par catégorie de lieu',
      "La part de vos impressions générées selon le type d'établissement diffuseur.",
    );
    if (s.categories.length === 0) {
      doc.fillColor(MUTED).font('Helvetica').fontSize(9.5).text('Aucune impression générée.', left);
      doc.moveDown(0.8);
    } else barRows(s.categories, 'impr.');

    // ── Section 03 — Profil de l'audience et niveau CSP ────────────────────
    sectionTitle(
      'Section 03',
      "Profil de l'audience et niveau CSP",
      "Le niveau de gamme des lieux diffuseurs, et la composition de l'audience mesurée dans ces lieux pendant la diffusion — sans identifier aucune personne.",
    );
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(10).text('Par niveau CSP', left);
    doc.moveDown(0.3);
    barRows(s.csp, 'impr.');
    doc
      .fillColor(INK)
      .font('Helvetica-Bold')
      .fontSize(10)
      .text('Audience mesurée dans les lieux', left);
    doc.moveDown(0.3);
    if (s.audience === null) {
      doc.fillColor(MUTED).font('Helvetica').fontSize(9.5).text('Aucune impression générée.', left);
      doc.moveDown(0.8);
    } else {
      doc.fillColor(MUTED).font('Helvetica').fontSize(9).text('Par sexe', left);
      barRows(s.audience.sex, '');
      doc.fillColor(MUTED).font('Helvetica').fontSize(9).text("Par tranche d'âge", left);
      barRows(s.audience.age, '');
      if (s.audience.unprofiledImpressions > 0) {
        doc
          .fillColor(MUTED)
          .font('Helvetica-Oblique')
          .fontSize(8.5)
          .text(
            `${fmtInt(s.audience.unprofiledImpressions)} impressions générées dans ${s.audience.unprofiledVenues} établissement(s) sans profil d'audience renseigné ne sont pas ventilées.`,
            left,
            doc.y,
            { width },
          );
        doc.moveDown(0.8);
      }
    }

    // ── Section 04 — Répartition par zone géographique ─────────────────────
    sectionTitle(
      'Section 04',
      'Répartition par zone géographique',
      'La couverture de vos impressions sur le Grand Tunis. Les zones peu ou pas couvertes sont signalées.',
    );
    barRows(s.zones, 'impressions', 5);

    // ── footer ──────────────────────────────────────────────────────────────
    ensureRoom(30);
    doc
      .fillColor(MUTED)
      .font('Helvetica')
      .fontSize(8)
      .text(
        'Toodooh · Mes performances · Screencaster — Les impressions sont présentées comme impressions générées ; les montants sont HT avec le TTC entre parenthèses.',
        left,
        doc.y + 6,
        { width },
      );

    doc.end();
  });
