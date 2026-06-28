import PDFDocument from 'pdfkit';

import { BRAND, INK, MUTED, loadLogo } from './facture.js';

// Monthly screenhost report PDF (toodooh-report). Reuses the facture pdfkit seam (PDFDocument →
// Buffer, the shared logo + palette). Branded + PLAIN NUMBERS only — total audience, a per-day table,
// the busiest day + the peak hour. NO heatmap / data-viz (matches the L-aff-view "plain numbers"
// preference). Rendered on-the-fly + streamed by the owner route; never stored. compress:false so a
// test can decode the text runs.

export interface MonthlyReportData {
  ownerName: string;
  venueName: string;
  month: string; // 'YYYY-MM'
  totalAudience: number;
  daily: { date: string; audience: number }[];
  peakDayOfWeek: number; // 1=Mon … 7=Sun
  peakHour: number; // 0–23
}

const DOW_FR = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
const dayName = (dow: number): string => DOW_FR[dow - 1] ?? '—';
const peakHourLabel = (h: number): string =>
  `${String(h).padStart(2, '0')}h–${String((h + 1) % 24).padStart(2, '0')}h`;

export const renderMonthlyReportPdf = (data: MonthlyReportData): Promise<Buffer> =>
  new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50, compress: false });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const left = doc.page.margins.left;
    const right = doc.page.width - doc.page.margins.right;
    const width = right - left;

    // ── header: logo (or wordmark) + title + month ──────────────────────────────
    const logo = loadLogo();
    if (logo) {
      doc.image(logo, left, 50, { width: 150 });
    } else {
      doc.fillColor(BRAND).font('Helvetica-Bold').fontSize(24).text('toodooh', left, 56);
    }
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(20).text('RAPPORT MENSUEL', left, 52, {
      align: 'right',
    });
    doc
      .fillColor(MUTED)
      .font('Helvetica')
      .fontSize(10)
      .text(`Mois: ${data.month}`, left, 80, { align: 'right' });

    doc.moveTo(left, 128).lineTo(right, 128).lineWidth(2).strokeColor(BRAND).stroke();

    // ── établissement (venue + owner) ───────────────────────────────────────────
    doc.fillColor(MUTED).font('Helvetica').fontSize(10).text('Établissement', left, 148);
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(13).text(data.venueName, left, 162);
    doc.fillColor(MUTED).font('Helvetica').fontSize(10).text(data.ownerName, left, 180);

    // ── headline numbers (plain, no viz) ────────────────────────────────────────
    doc.fillColor(MUTED).font('Helvetica').fontSize(10).text('Audience totale du mois', left, 214);
    doc
      .fillColor(BRAND)
      .font('Helvetica-Bold')
      .fontSize(26)
      .text(String(data.totalAudience), left, 228);

    doc.fillColor(MUTED).font('Helvetica').fontSize(10).text('Jour le plus actif', left, 276);
    doc
      .fillColor(INK)
      .font('Helvetica-Bold')
      .fontSize(13)
      .text(dayName(data.peakDayOfWeek), left, 290);
    doc
      .fillColor(MUTED)
      .font('Helvetica')
      .fontSize(10)
      .text('Heure de pointe', left + 220, 276);
    doc
      .fillColor(INK)
      .font('Helvetica-Bold')
      .fontSize(13)
      .text(peakHourLabel(data.peakHour), left + 220, 290);

    // ── per-day breakdown (plain table: Date | Audience) ────────────────────────
    let y = 336;
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(12).text('Détail par jour', left, y);
    y += 22;
    doc
      .fillColor(MUTED)
      .font('Helvetica-Bold')
      .fontSize(9)
      .text('Date', left, y)
      .text('Audience', left + 220, y);
    y += 14;
    doc.moveTo(left, y).lineTo(right, y).lineWidth(0.5).strokeColor(MUTED).stroke();
    y += 6;
    for (const entry of data.daily) {
      if (y > doc.page.height - 70) {
        doc.addPage();
        y = 50;
      }
      doc
        .fillColor(INK)
        .font('Helvetica')
        .fontSize(10)
        .text(entry.date, left, y)
        .text(String(entry.audience), left + 220, y);
      y += 16;
    }

    // ── footer ──────────────────────────────────────────────────────────────────
    doc
      .fillColor(MUTED)
      .font('Helvetica')
      .fontSize(8)
      .text("toodooh — réseau d'affichage DOOH en Tunisie", left, doc.page.height - 40, {
        align: 'center',
        width,
      });

    doc.end();
  });
