import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import PDFDocument from 'pdfkit';

import type { Env } from '../env.js';
import { logger } from '../logger.js';

// Facture (invoice) PDF capability (L-wallet) — a clean, branded recharge invoice rendered from row
// data + static config. pdfkit is the dependency-light choice (pure JS, no native deps, no headless
// Chromium); the document streams. This is the reusable PDF seam L-report inherits — renderFacturePdf
// returns a Buffer so callers may stream it (the recharge facture route does) or persist it later.

const log = logger.child({ module: 'facture' });

// Brand palette. In the React app #00B3A6 is the Tailwind `brand` token; a server-rendered PDF has no
// Tailwind/token layer, so the hex lives here (the styling rule is a frontend rule). Flagged.
// Exported as the shared PDF brand seam (lib/report.ts reuses them — same wordmark/palette/logo).
export const BRAND = '#00b3a6';
export const INK = '#1a1a1a';
export const MUTED = '#6b7280';

export interface FactureBankDetails {
  beneficiary: string;
  bankName: string;
  rib: string;
  iban: string;
}

export interface FactureData {
  reference: string;
  amountTnd: number;
  advertiserName: string;
  issuedAt: Date;
  bank: FactureBankDetails;
}

// Build the bank block from env (placeholder '—' defaults until the operator provisions real values).
export const factureBankDetailsFromEnv = (e: Env): FactureBankDetails => ({
  beneficiary: e.FACTURE_BANK_BENEFICIARY,
  bankName: e.FACTURE_BANK_NAME,
  rib: e.FACTURE_BANK_RIB,
  iban: e.FACTURE_BANK_IBAN,
});

// Logo: a committed package asset resolved relative to THIS module via import.meta.url, so it works
// from both src/ (tsx/vitest) and dist/ (compiled) — assets/ is a sibling of both. Read once + cached;
// a missing/unreadable asset degrades to a text wordmark (never fails the facture).
let logoCache: Buffer | null | undefined;
export const loadLogo = (): Buffer | null => {
  if (logoCache !== undefined) return logoCache;
  try {
    logoCache = readFileSync(fileURLToPath(new URL('../../assets/logo.png', import.meta.url)));
  } catch (err) {
    log.warn({ err }, 'facture logo asset missing — rendering a text wordmark instead');
    logoCache = null;
  }
  return logoCache;
};

// Plain, greppable money format: "150.50 TND" (no locale grouping/comma — keeps the amount literal in
// the PDF content stream and unambiguous on the invoice).
const formatTnd = (amount: number): string => `${amount.toFixed(2)} TND`;

const formatIssuedAt = (d: Date): string => d.toISOString().slice(0, 10);

// Render the facture to a Buffer. compress:false leaves the content stream UNCOMPRESSED (no
// FlateDecode) so the test can decode the hex-encoded text runs to assert the amount/reference are
// present; the facture is a single tiny page, so the size cost is irrelevant.
export const renderFacturePdf = (data: FactureData): Promise<Buffer> =>
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
      .text(`Date: ${formatIssuedAt(data.issuedAt)}`, { align: 'right' });

    doc.moveTo(left, 128).lineTo(right, 128).lineWidth(2).strokeColor(BRAND).stroke();

    // ── billed to ──────────────────────────────────────────────────────────────
    doc.fillColor(MUTED).font('Helvetica').fontSize(10).text('Facturé à', left, 148);
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(13).text(data.advertiserName, left, 162);

    // ── line item + amount due ───────────────────────────────────────────────────
    doc.fillColor(MUTED).font('Helvetica').fontSize(10).text('Description', left, 210);
    doc
      .fillColor(INK)
      .font('Helvetica')
      .fontSize(12)
      .text('Rechargement de compte (crédit publicitaire)', left, 224);
    doc.fillColor(MUTED).font('Helvetica').fontSize(10).text('Montant à régler', left, 258);
    doc
      .fillColor(BRAND)
      .font('Helvetica-Bold')
      .fontSize(22)
      .text(formatTnd(data.amountTnd), left, 272);

    // ── bank-transfer coordinates ────────────────────────────────────────────────
    let y = 340;
    doc
      .fillColor(INK)
      .font('Helvetica-Bold')
      .fontSize(12)
      .text('Coordonnées bancaires pour le virement', left, y);
    y += 24;
    const bankLine = (label: string, value: string): void => {
      doc.fillColor(MUTED).font('Helvetica').fontSize(10).text(label, left, y, { width: 110 });
      doc
        .fillColor(INK)
        .font('Helvetica')
        .fontSize(11)
        .text(value, left + 120, y);
      y += 20;
    };
    bankLine('Bénéficiaire', data.bank.beneficiary);
    bankLine('Banque', data.bank.bankName);
    bankLine('RIB', data.bank.rib);
    bankLine('IBAN', data.bank.iban);

    y += 8;
    doc
      .fillColor(MUTED)
      .font('Helvetica')
      .fontSize(9)
      .text(`Merci d'indiquer la référence ${data.reference} dans le motif du virement.`, left, y, {
        width,
      });

    // ── footer ────────────────────────────────────────────────────────────────────
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
