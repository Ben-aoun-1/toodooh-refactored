import PDFDocument from 'pdfkit';

import { BRAND, INK, MUTED, TVA_RATE, loadLogo } from './facture.js';
import { monthLabelFr } from './report/monthly-job.js';

// FCT2 (US-FCT-11..12) — the ONE real invoice: the monthly consolidated « FACTURE » per
// screencaster, on REAL proof-verified consumption (deliveredFacturableInRange × the plan CPM),
// HT + TVA 19 %. ONE amount — no per-campaign detail by charter. Rendered once by the month-end
// job and STORED (invoices/<advertiserId>/<month>.pdf) — a fiscal document must be byte-stable
// across downloads, the bon-de-commande posture, unlike the on-the-fly récapitulatif. pdfkit,
// compress:false (the facture test-decoding rationale).

export interface MonthlyInvoiceData {
  reference: string;
  month: string; // 'YYYY-MM'
  advertiserName: string;
  totalHt: number;
  tvaTnd: number;
  totalTtc: number;
  issuedAt: Date;
}

const formatTnd = (amount: number): string => `${amount.toFixed(2)} TND`;

const formatIssuedAt = (d: Date): string => d.toISOString().slice(0, 10);

// FCT-R1 (Kais 29/07) — engagement-honest wording: the cast bills PREDICTED impressions
// pre-paid; the « consommation réelle » era (US-FCT-12) is superseded.
export const INVOICE_DESCRIPTION_LINE = 'Campagnes du mois — montant engagé (impressions prévues)';
export const INVOICE_SETTLEMENT_NOTE =
  'Facture établie sur le montant engagé des campagnes du mois (impressions prévues), réglée par prélèvement sur votre solde publicitaire.';

export const renderMonthlyInvoicePdf = (data: MonthlyInvoiceData): Promise<Buffer> =>
  new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50, compress: false });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const left = doc.page.margins.left;
    const right = doc.page.width - doc.page.margins.right;
    const width = right - left;

    // ── header: logo (or wordmark) + invoice meta ──────────────────────────────
    const logo = loadLogo();
    if (logo) {
      doc.image(logo, left, 50, { width: 150 });
    } else {
      doc.fillColor(BRAND).font('Helvetica-Bold').fontSize(24).text('toodooh', left, 56);
    }
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(20).text('FACTURE', left, 52, {
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

    // ── billed to ──────────────────────────────────────────────────────────────
    doc.fillColor(MUTED).font('Helvetica').fontSize(10).text('Facturé à', left, 152);
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(13).text(data.advertiserName, left, 166);

    // ── the ONE consolidated line (no per-campaign detail — chartered) ─────────
    doc.fillColor(MUTED).font('Helvetica').fontSize(10).text('Description', left, 214);
    doc
      .fillColor(INK)
      .font('Helvetica')
      .fontSize(12)
      .text(`${INVOICE_DESCRIPTION_LINE} de ${monthLabelFr(data.month)}`, left, 228, { width });

    const moneyLine = (label: string, value: string, yLine: number, bold = false): void => {
      doc.fillColor(MUTED).font('Helvetica').fontSize(10).text(label, left, yLine, { width: 160 });
      doc
        .fillColor(bold ? BRAND : INK)
        .font(bold ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(bold ? 14 : 11)
        .text(value, left + 170, yLine - (bold ? 2 : 0));
    };
    moneyLine('Montant HT', formatTnd(data.totalHt), 272);
    moneyLine(`TVA (${Math.round(TVA_RATE * 100)} %)`, formatTnd(data.tvaTnd), 292);
    moneyLine('Total TTC', formatTnd(data.totalTtc), 312, true);

    doc.fillColor(MUTED).font('Helvetica').fontSize(9).text(INVOICE_SETTLEMENT_NOTE, left, 348, {
      width,
    });

    // ── footer ────────────────────────────────────────────────────────────────
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
