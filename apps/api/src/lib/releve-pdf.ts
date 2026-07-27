import PDFDocument from 'pdfkit';

import { BRAND, INK, MUTED, loadLogo } from './facture.js';
import { monthLabelFr } from './report/monthly-job.js';

// FCT2 — the monthly « RELEVÉ DE REVERSEMENT » per venue: Σ reversement_lines.sh_amount_tnd over
// the lines settled that Tunis month (the 50 % SH share — campaign_screenhost_payout parity by
// E7 construction). ONE amount, French; rendered once by the month-end job and STORED
// (statements/<screenhostId>/<month>.pdf) — the server replaces the mock client-side jsPDF relevé.
// No TVA block: the reversement is the venue's share, its fiscal treatment is the venue's own.

export interface ReleveData {
  reference: string;
  month: string; // 'YYYY-MM'
  venueName: string;
  ownerName: string;
  totalShTnd: number;
  issuedAt: Date;
}

const formatTnd = (amount: number): string => `${amount.toFixed(2)} TND`;

const formatIssuedAt = (d: Date): string => d.toISOString().slice(0, 10);

export const RELEVE_DESCRIPTION_LINE =
  'Reversement sur les campagnes diffusées au sein de votre établissement';
export const RELEVE_NOTE =
  'Part établissement (50 %) des règlements constatés sur la période, conformément au barème de reversement Toodooh.';

export const renderRelevePdf = (data: ReleveData): Promise<Buffer> =>
  new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50, compress: false });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const left = doc.page.margins.left;
    const right = doc.page.width - doc.page.margins.right;
    const width = right - left;

    // ── header ─────────────────────────────────────────────────────────────────
    const logo = loadLogo();
    if (logo) {
      doc.image(logo, left, 50, { width: 150 });
    } else {
      doc.fillColor(BRAND).font('Helvetica-Bold').fontSize(24).text('toodooh', left, 56);
    }
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(16).text('RELEVÉ DE REVERSEMENT', left, 54, {
      align: 'right',
    });
    doc
      .fillColor(MUTED)
      .font('Helvetica')
      .fontSize(10)
      .text(`Référence: ${data.reference}`, left, 80, { align: 'right' })
      .text(`Période: ${monthLabelFr(data.month)}`, { align: 'right' })
      .text(`Date d'émission: ${formatIssuedAt(data.issuedAt)}`, { align: 'right' });

    doc.moveTo(left, 132).lineTo(right, 132).lineWidth(2).strokeColor(BRAND).stroke();

    // ── the venue + its owner ──────────────────────────────────────────────────
    doc.fillColor(MUTED).font('Helvetica').fontSize(10).text('Établissement', left, 152);
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(13).text(data.venueName, left, 166);
    doc.fillColor(MUTED).font('Helvetica').fontSize(10).text(data.ownerName, left, 184);

    // ── the ONE aggregate line ─────────────────────────────────────────────────
    doc.fillColor(MUTED).font('Helvetica').fontSize(10).text('Description', left, 220);
    doc
      .fillColor(INK)
      .font('Helvetica')
      .fontSize(12)
      .text(`${RELEVE_DESCRIPTION_LINE} — ${monthLabelFr(data.month)}`, left, 234, { width });

    doc
      .fillColor(MUTED)
      .font('Helvetica')
      .fontSize(10)
      .text('Total reversé', left, 280, { width: 160 });
    doc
      .fillColor(BRAND)
      .font('Helvetica-Bold')
      .fontSize(14)
      .text(formatTnd(data.totalShTnd), left + 170, 278);

    doc.fillColor(MUTED).font('Helvetica').fontSize(9).text(RELEVE_NOTE, left, 316, { width });

    // ── footer ─────────────────────────────────────────────────────────────────
    doc
      .fillColor(MUTED)
      .font('Helvetica')
      .fontSize(8)
      .text("toodooh — réseau d'affichage DOOH en Tunisie", left, doc.page.height - 72, {
        align: 'center',
        width,
      });

    doc.end();
  });
