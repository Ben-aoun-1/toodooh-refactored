import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import PDFDocument from 'pdfkit';

import { logger } from '../logger.js';

import type { ResolvedDispatchConfig } from './dispatch/config.js';

// « Récapitulatif de commande » PDF capability (L-wallet) — the per-recharge document, rendered
// from row data + config. FCT2 (US-FCT-12) RELABELED it from « FACTURE »: recharges never invoice —
// the ONE real invoice is the monthly consolidated facture (lib/monthly-invoice-pdf.ts, on
// proof-verified consumption). The artifact itself is KEPT byte-for-byte in structure: same
// HT/TVA/TTC block, same bank coordinates, same on-the-fly render; only the title/filename changed.
// pdfkit is the dependency-light choice (pure JS, no native deps, no headless Chromium); the
// document streams. renderFacturePdf returns a Buffer so callers may stream it or persist it later.

const log = logger.child({ module: 'facture' });

// Brand palette. In the React app #00B3A6 is the Tailwind `brand` token; a server-rendered PDF has no
// Tailwind/token layer, so the hex lives here (the styling rule is a frontend rule). Flagged.
// Exported as the shared PDF brand seam (lib/report.ts reuses them — same wordmark/palette/logo).
export const BRAND = '#00b3a6';
export const INK = '#1a1a1a';
export const MUTED = '#6b7280';

// CF-C1 (ruling #2's banked half) — the api-side TVA rate, ONE home, mirror-pinned against the
// web's lib/money.ts TVA_RATE (the two apps don't share a package). The recharge amount is HT:
// the advertiser WIRES the TTC, the wallet CREDITS the HT — both stated on the facture.
export const TVA_RATE = 0.19;

/** TTC from HT — the money.ts rounding convention (2 decimals, round-half-up via Math.round). */
export const ttcFromHt = (amountHt: number): number =>
  Math.round(amountHt * (1 + TVA_RATE) * 100) / 100;

/** The TVA line amount, additive-consistent: HT + TVA always equals the printed TTC. */
export const tvaFromHt = (amountHt: number): number =>
  Math.round((ttcFromHt(amountHt) - amountHt) * 100) / 100;

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

// « Bénéficiaire » — the company's own name. It has no dispatch_config column and is not a secret
// or a per-environment value, so it is a constant rather than the env var it used to read.
const FACTURE_BENEFICIARY = 'TOODOOH';

// GREEN1 — bank-coords CONVERGENCE COMPLETE: dispatch_config.bank_* is the ONE home (FCT1's
// « Pour info » block already read it). The FACTURE_BANK_* env block that used to sit behind this
// as a "transition fallback" was removed: prod never carried those vars, so they always resolved
// to their '—' defaults, which is exactly what an unprovisioned config already returns — the
// fallback could not change a single field, and its "serving from env" warning was unreachable.
// Field mapping: rib/iban are 1:1; « Banque » ↔ bank_domiciliation (bank + agency IS the
// domiciliation). '—' means not yet provisioned; the operator sets real values by SQL, never code.
export const resolveFactureBankDetails = (
  cfg: Pick<ResolvedDispatchConfig, 'bankRib' | 'bankIban' | 'bankDomiciliation'>,
): FactureBankDetails => ({
  beneficiary: FACTURE_BENEFICIARY,
  bankName: cfg.bankDomiciliation,
  rib: cfg.bankRib,
  iban: cfg.bankIban,
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
    // FCT2 (US-FCT-12) — the relabel: this document is NOT an invoice (recharges never invoice);
    // the real facture is the monthly consolidated one.
    doc
      .fillColor(INK)
      .font('Helvetica-Bold')
      .fontSize(15)
      .text('RÉCAPITULATIF DE COMMANDE', left, 56, {
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

    // ── line item + the HT / TVA / TTC block (CF-C1, ruling #2's banked half) ─────
    // The recharge amount is HT: the wallet credits the HT; the wire carries the TTC.
    const ht = data.amountTnd;
    const tva = tvaFromHt(ht);
    const ttc = ttcFromHt(ht);
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
    moneyLine(`TVA (${Math.round(TVA_RATE * 100)} %)`, formatTnd(tva), 274);
    moneyLine('Total TTC (à régler)', formatTnd(ttc), 294, true);
    doc
      .fillColor(MUTED)
      .font('Helvetica')
      .fontSize(9)
      .text(`Montant crédité au solde : ${formatTnd(ht)} HT`, left, 318);

    // ── bank-transfer coordinates ────────────────────────────────────────────────
    let y = 356;
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
      .text(
        `Merci d'effectuer un virement de ${formatTnd(ttcFromHt(data.amountTnd))} TTC en indiquant la référence ${data.reference} dans le motif.`,
        left,
        y,
        { width },
      );

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
