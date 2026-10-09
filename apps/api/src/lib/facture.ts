import type { ResolvedDispatchConfig } from './dispatch/config.js';
import {
  docCard,
  docLines,
  docNote,
  docParties,
  docTnd,
  docTotals,
  renderDocHtml,
} from './pdf-doc/document.js';
import { renderPdf } from './report/render.js';

// « Récapitulatif de commande » PDF capability (L-wallet) — the per-recharge document, rendered
// from row data + config. FCT2 (US-FCT-12) RELABELED it from « FACTURE »: recharges never invoice —
// the ONE real invoice is the monthly consolidated facture (lib/monthly-invoice-pdf.ts, on
// proof-verified consumption). The artifact itself is KEPT byte-for-byte in structure: same
// HT/TVA/TTC block, same bank coordinates, same on-the-fly render; only the title/filename changed.
// Operator 2026-10-09: every document follows the screenhost report's charter with the real logo
// (lib/pdf-doc), rendered by the report's chromium pipeline — pdfkit is retired for documents.
// renderFacturePdf returns a Buffer so callers may stream it or persist it later.

// CF-C1 (ruling #2's banked half) — the api-side TVA rate, ONE home, mirror-pinned against the
// web's lib/money.ts TVA_RATE (the two apps don't share a package). The recharge amount is HT:
// the advertiser WIRES the TTC, the wallet CREDITS the HT — both stated on the facture.
export const TVA_RATE = 0.19;

/** TTC from HT — the money.ts rounding convention (2 decimals, round-half-up via Math.round). */
export const ttcFromHt = (amountHt: number): number =>
  Math.round(amountHt * (1 + TVA_RATE) * 100) / 100;

/**
 * HT from TTC — the reverse of ttcFromHt, same rounding. SH-TTC1 (operator ruling 2026-09-29): the
 * screenhost's 50 % share IS a TTC amount (10 000 HT paid by the screencaster → 5 000 TTC to the
 * venue), so the screenhost facture derives its HT from the share, never the other way round.
 */
export const htFromTtc = (amountTtc: number): number =>
  Math.round((amountTtc / (1 + TVA_RATE)) * 100) / 100;

/**
 * The screenhost facture's money trio from its stored total (Σ share = TTC, SH-TTC1). ONE home:
 * the monthly sweep and the SH-TTC1 regeneration script both print exactly these three figures.
 */
export const screenhostFactureMoney = (
  totalTtc: number,
): { subtotalHt: number; tva: number; totalTtc: number } => {
  const subtotalHt = htFromTtc(totalTtc);
  return { subtotalHt, tva: Math.round((totalTtc - subtotalHt) * 1e4) / 1e4, totalTtc };
};

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

// Plain, greppable money format: "150.50 TND" (lib/pdf-doc docTnd — no locale comma, literal).
const formatIssuedAt = (d: Date): string => d.toISOString().slice(0, 10);

/**
 * The récapitulatif's HTML — operator 2026-10-09: the report's charter on white paper (it is
 * printed for the wire transfer), the real logo (lib/pdf-doc). Content unchanged: the HT/TVA/TTC
 * block (CF-C1: the wallet credits the HT, the wire carries the TTC) and the bank coordinates.
 */
export const buildFactureHtml = (data: FactureData): string => {
  const ht = data.amountTnd;
  const ttc = ttcFromHt(ht);
  return renderDocHtml({
    paper: 'light',
    // FCT2 (US-FCT-12) — the relabel: this document is NOT an invoice (recharges never invoice);
    // the real facture is the monthly consolidated one.
    kicker: 'Récapitulatif de commande',
    title: 'Rechargement de compte',
    meta: [
      { label: 'Référence', value: data.reference },
      { label: 'Date', value: formatIssuedAt(data.issuedAt) },
    ],
    body:
      docParties([{ label: 'Facturé à', name: data.advertiserName }]) +
      docLines({ label: 'Description', amount: 'Montant HT' }, [
        { label: 'Rechargement de compte (crédit publicitaire)', amount: docTnd(ht) },
      ]) +
      docTotals(
        [
          { label: 'Montant HT', amount: docTnd(ht) },
          { label: `TVA (${Math.round(TVA_RATE * 100)} %)`, amount: docTnd(tvaFromHt(ht)) },
        ],
        { label: 'Total TTC (à régler)', amount: docTnd(ttc) },
      ) +
      docNote(`Montant crédité au solde : ${docTnd(ht)} HT`) +
      docCard('Coordonnées bancaires pour le virement', [
        { label: 'Bénéficiaire', value: data.bank.beneficiary },
        { label: 'Banque', value: data.bank.bankName },
        { label: 'RIB', value: data.bank.rib },
        { label: 'IBAN', value: data.bank.iban },
      ]) +
      docNote(
        `Merci d'effectuer un virement de ${docTnd(ttc)} TTC en indiquant la référence ${data.reference} dans le motif.`,
      ),
  });
};

/** The récapitulatif PDF — the report's chromium pipeline (lib/report/render). */
export const renderFacturePdf = (data: FactureData): Promise<Buffer> =>
  renderPdf(buildFactureHtml(data));
