import PDFDocument from 'pdfkit';

import { BRAND, INK, MUTED, TVA_RATE, loadLogo, ttcFromHt, tvaFromHt } from './facture.js';

// FCT1 (US-FCT-5/6) — the auto-generated « bon de commande » PDF for the bon_de_commande recharge
// method: identity + montant + BC-reference + a signature block, French. Reuses the facture's
// pdfkit seam (BRAND/INK/MUTED palette, loadLogo, the TVA trio) — pure JS, renders synchronously in
// the request, no chromium. Unlike the facture (deterministic re-render, never stored) the bon IS
// stored: it is rendered once at creation, uploaded under recharges/<id>/bon.pdf and re-served
// verbatim — the paper the client signs must be byte-stable across downloads.
//
// Money convention: the facture's (CF-C1) — the recharge amount is HT, the wallet credits the HT,
// the client engages the TTC. The bon prints the same three lines so the two documents can't drift.

export interface BonDeCommandeData {
  reference: string;
  amountTnd: number;
  advertiserName: string;
  issuedAt: Date;
}

const formatTnd = (amount: number): string => `${amount.toFixed(2)} TND`;

const formatIssuedAt = (d: Date): string => d.toISOString().slice(0, 10);

// The signature invite printed on the bon — exported so the route test can pin the chartered copy.
export const BON_SIGNATURE_MENTION =
  'Signature du client, précédée de la mention « Bon pour accord »';
export const BON_RETURN_INSTRUCTION =
  'À imprimer, signer et redéposer sur votre espace Toodooh (Recharge rapide).';

// Render the bon to a Buffer. compress:false — same rationale as the facture: the test decodes the
// uncompressed hex text runs to assert reference/amount/copy; a single page costs nothing.
export const renderBonDeCommandePdf = (data: BonDeCommandeData): Promise<Buffer> =>
  new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50, compress: false });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const left = doc.page.margins.left;
    const right = doc.page.width - doc.page.margins.right;
    const width = right - left;

    // ── header: logo (or wordmark) + document meta ─────────────────────────────
    const logo = loadLogo();
    if (logo) {
      doc.image(logo, left, 50, { width: 150 });
    } else {
      doc.fillColor(BRAND).font('Helvetica-Bold').fontSize(24).text('toodooh', left, 56);
    }
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(20).text('BON DE COMMANDE', left, 52, {
      align: 'right',
    });
    doc
      .fillColor(MUTED)
      .font('Helvetica')
      .fontSize(10)
      .text(`Référence: ${data.reference}`, left, 80, { align: 'right' })
      .text(`Date: ${formatIssuedAt(data.issuedAt)}`, { align: 'right' });

    doc.moveTo(left, 128).lineTo(right, 128).lineWidth(2).strokeColor(BRAND).stroke();

    // ── client identity ────────────────────────────────────────────────────────
    doc.fillColor(MUTED).font('Helvetica').fontSize(10).text('Client', left, 148);
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(13).text(data.advertiserName, left, 162);

    // ── line item + the HT / TVA / TTC block (the facture's CF-C1 convention) ──
    const ht = data.amountTnd;
    doc.fillColor(MUTED).font('Helvetica').fontSize(10).text('Description', left, 210);
    doc
      .fillColor(INK)
      .font('Helvetica')
      .fontSize(12)
      .text('Rechargement de compte (crédit publicitaire)', left, 224);
    const moneyLine = (label: string, value: string, yLine: number, bold = false): void => {
      doc.fillColor(MUTED).font('Helvetica').fontSize(10).text(label, left, yLine, { width: 160 });
      doc
        .fillColor(bold ? BRAND : INK)
        .font(bold ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(bold ? 14 : 11)
        .text(value, left + 170, yLine - (bold ? 2 : 0));
    };
    moneyLine('Montant HT', formatTnd(ht), 254);
    moneyLine(`TVA (${Math.round(TVA_RATE * 100)} %)`, formatTnd(tvaFromHt(ht)), 274);
    moneyLine('Total TTC (à régler)', formatTnd(ttcFromHt(ht)), 294, true);
    doc
      .fillColor(MUTED)
      .font('Helvetica')
      .fontSize(9)
      .text(`Montant crédité au solde : ${formatTnd(ht)} HT`, left, 318);

    // ── signature block ────────────────────────────────────────────────────────
    let y = 356;
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(12).text('Bon pour accord', left, y);
    y += 22;
    doc.fillColor(MUTED).font('Helvetica').fontSize(10).text(BON_SIGNATURE_MENTION, left, y, {
      width,
    });
    y += 28;
    // The signature line the client signs above.
    doc
      .moveTo(left, y + 40)
      .lineTo(left + 220, y + 40)
      .lineWidth(1)
      .strokeColor(MUTED)
      .stroke();
    doc
      .fillColor(MUTED)
      .font('Helvetica')
      .fontSize(9)
      .text('Signature et cachet', left, y + 46);

    y += 84;
    doc.fillColor(INK).font('Helvetica').fontSize(10).text(BON_RETURN_INSTRUCTION, left, y, {
      width,
    });

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
