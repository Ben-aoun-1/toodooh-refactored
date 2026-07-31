import PDFDocument from 'pdfkit';

import { BRAND, INK, MUTED, TVA_RATE, loadLogo } from './facture.js';
import { monthLabelFr } from './report/monthly-job.js';

// REV2 — the SCREENHOST facture. A supplier invoice, and the direction is the whole point:
//
//   ÉMETTEUR : the screenhost's établissement (they are billing)
//   CLIENT   : Toodooh (we are being billed)
//
// This is the exact opposite of the screencaster facture (lib/monthly-invoice-pdf.ts, FM-), where
// Toodooh bills the advertiser. The spec is explicit that the two « ne doivent jamais être
// confondus », so the layout is deliberately different, not a restyle: TWO party blocks side by
// side (the screencaster template has a single « Facturé à »), a per-source line TABLE (it has a
// one-line description), and a returned-document consigne it has no equivalent of.
//
// WHAT THIS TEMPLATE MUST NEVER PRINT. The relevé it replaces carried
//   « Part établissement (50 %) … conformément au barème de reversement Toodooh. »
// on every owner's document — the reversement SPLIT, disclosed to the screenhost, shipping since
// FCT2. This builder is given only what the owner is entitled to see (amounts they earned), never
// a rate, a share or a score, and a test extracts the rendered text to keep it that way.

export interface ScreenhostFactureLine {
  /** 'campaign' | 'event' — the reversement_lines.source bucket. */
  source: string;
  /** Σ sh_amount_tnd for that source in the month (HT). */
  amountHtTnd: number;
}

export interface ScreenhostFactureData {
  reference: string;
  month: string; // 'YYYY-MM'
  venueName: string;
  ownerName: string;
  lines: ScreenhostFactureLine[];
  subtotalHtTnd: number;
  tvaTnd: number;
  totalTtcTnd: number;
  issuedAt: Date;
}

/** The client block is fixed: Toodooh is always the one being billed on this document. */
export const TOODOOH_CLIENT_NAME = 'TOODOOH';

export const CONSIGNE_LINE =
  'Merci d’imprimer, signer, cacheter et renvoyer ce document via la section « Déposer votre facture signée ».';

/** French labels per reversement source. An unknown source degrades to a neutral wording. */
export const sourceLabelFr = (source: string): string => {
  if (source === 'event') return 'Revenus de diffusion — événements';
  if (source === 'campaign') return 'Revenus de diffusion — campagnes';
  return 'Revenus de diffusion';
};

const formatTnd = (n: number): string => `${n.toFixed(2)} TND`;

const formatIssuedAt = (d: Date): string =>
  `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;

export const renderScreenhostFacturePdf = async (data: ScreenhostFactureData): Promise<Buffer> => {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50, compress: false });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const left = 50;
    const right = doc.page.width - 50;
    const width = right - left;

    // ── header ────────────────────────────────────────────────────────────────
    const logo = loadLogo();
    if (logo) {
      doc.image(logo, left, 50, { height: 28 });
    } else {
      doc.fillColor(BRAND).font('Helvetica-Bold').fontSize(24).text('toodooh', left, 56);
    }
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(20).text('FACTURE', left, 52, {
      width,
      align: 'right',
    });
    doc
      .fillColor(MUTED)
      .font('Helvetica')
      .fontSize(10)
      .text(`Référence: ${data.reference}`, left, 80, { align: 'right' })
      .text(`Période: ${monthLabelFr(data.month)}`, { align: 'right' })
      .text(`Date d'émission: ${formatIssuedAt(data.issuedAt)}`, { align: 'right' });

    // ── the two party blocks, side by side — THE direction, stated plainly ────
    const colW = (width - 20) / 2;
    doc.fillColor(MUTED).font('Helvetica').fontSize(10).text('Émetteur', left, 140);
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(13).text(data.venueName, left, 154, {
      width: colW,
    });
    doc
      .fillColor(MUTED)
      .font('Helvetica')
      .fontSize(10)
      .text(data.ownerName, left, doc.y + 2, { width: colW });

    const rightCol = left + colW + 20;
    doc.fillColor(MUTED).font('Helvetica').fontSize(10).text('Client', rightCol, 140);
    doc
      .fillColor(INK)
      .font('Helvetica-Bold')
      .fontSize(13)
      .text(TOODOOH_CLIENT_NAME, rightCol, 154, { width: colW });
    doc
      .fillColor(MUTED)
      .font('Helvetica')
      .fontSize(10)
      .text("Réseau d'affichage DOOH — Tunisie", rightCol, doc.y + 2, { width: colW });

    // ── the per-source revenue lines ──────────────────────────────────────────
    let y = 232;
    doc.fillColor(MUTED).font('Helvetica').fontSize(10).text('Désignation', left, y);
    doc.text('Montant HT', left, y, { width, align: 'right' });
    y += 16;
    doc.strokeColor('#E5E7EB').lineWidth(1).moveTo(left, y).lineTo(right, y).stroke();
    y += 10;

    for (const line of data.lines) {
      doc
        .fillColor(INK)
        .font('Helvetica')
        .fontSize(11)
        .text(sourceLabelFr(line.source), left, y, {
          width: width - 120,
        });
      doc.text(formatTnd(line.amountHtTnd), left, y, { width, align: 'right' });
      y += 22;
    }

    // ── the money trio ────────────────────────────────────────────────────────
    y += 8;
    doc.strokeColor('#E5E7EB').lineWidth(1).moveTo(left, y).lineTo(right, y).stroke();
    y += 12;

    const moneyLine = (label: string, value: string, bold: boolean, atY: number): void => {
      doc
        .fillColor(bold ? INK : MUTED)
        .font(bold ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(bold ? 13 : 11)
        .text(label, left, atY, { width: width - 140 });
      doc
        .fillColor(INK)
        .font(bold ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(bold ? 13 : 11)
        .text(value, left, atY, { width, align: 'right' });
    };

    moneyLine('Sous-total HT', formatTnd(data.subtotalHtTnd), false, y);
    moneyLine(`TVA (${Math.round(TVA_RATE * 100)} %)`, formatTnd(data.tvaTnd), false, y + 20);
    moneyLine('Total TTC', formatTnd(data.totalTtcTnd), true, y + 46);

    // ── the consigne — what the owner must DO with this document ──────────────
    doc
      .fillColor(MUTED)
      .font('Helvetica')
      .fontSize(9)
      .text(CONSIGNE_LINE, left, y + 92, { width });

    doc
      .fillColor(MUTED)
      .font('Helvetica')
      .fontSize(8)
      .text("toodooh — réseau d'affichage DOOH en Tunisie", left, doc.page.height - 72, {
        width,
        align: 'center',
      });

    doc.end();
  });
};
