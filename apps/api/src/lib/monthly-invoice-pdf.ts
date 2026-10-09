import { TVA_RATE } from './facture.js';
import {
  docLines,
  docNote,
  docParties,
  docTnd,
  docTotals,
  renderDocHtml,
} from './pdf-doc/document.js';
import { monthLabelFr } from './report/monthly-job.js';
import { renderPdf } from './report/render.js';

// FCT2 (US-FCT-11..12) — the ONE real invoice: the monthly consolidated « FACTURE » per
// screencaster, on REAL proof-verified consumption (deliveredFacturableInRange × the plan CPM),
// HT + TVA 19 %. ONE amount — no per-campaign detail by charter. Rendered once by the month-end
// job and STORED (invoices/<advertiserId>/<month>.pdf) — a fiscal document must be byte-stable
// across downloads, the bon-de-commande posture, unlike the on-the-fly récapitulatif. Operator
// 2026-10-09: the report's charter + the real logo (lib/pdf-doc), chromium-rendered.

export interface MonthlyInvoiceData {
  reference: string;
  month: string; // 'YYYY-MM'
  advertiserName: string;
  totalHt: number;
  tvaTnd: number;
  totalTtc: number;
  issuedAt: Date;
}

const formatIssuedAt = (d: Date): string => d.toISOString().slice(0, 10);

// FCT-R1 (Kais 29/07) — engagement-honest wording: the cast bills PREDICTED impressions
// pre-paid; the « consommation réelle » era (US-FCT-12) is superseded.
export const INVOICE_DESCRIPTION_LINE = 'Campagnes du mois — montant engagé (impressions prévues)';
export const INVOICE_SETTLEMENT_NOTE =
  'Facture établie sur le montant engagé des campagnes du mois (impressions prévues), réglée par prélèvement sur votre solde publicitaire.';

/** The monthly invoice's HTML — the report's charter on white paper, the real logo (2026-10-09). */
export const buildMonthlyInvoiceHtml = (data: MonthlyInvoiceData): string =>
  renderDocHtml({
    paper: 'light',
    kicker: 'Facture',
    title: data.advertiserName,
    meta: [
      { label: 'Référence', value: data.reference },
      { label: 'Période', value: monthLabelFr(data.month) },
      { label: "Date d'émission", value: formatIssuedAt(data.issuedAt) },
    ],
    body:
      docParties([
        { label: 'Facturé à', name: data.advertiserName },
        { label: 'Émetteur', name: 'TOODOOH', lines: ["Réseau d'affichage DOOH — Tunisie"] },
      ]) +
      // The ONE consolidated line (no per-campaign detail — chartered).
      docLines({ label: 'Description', amount: 'Montant HT' }, [
        {
          label: `${INVOICE_DESCRIPTION_LINE} de ${monthLabelFr(data.month)}`,
          amount: docTnd(data.totalHt),
        },
      ]) +
      docTotals(
        [
          { label: 'Montant HT', amount: docTnd(data.totalHt) },
          { label: `TVA (${Math.round(TVA_RATE * 100)} %)`, amount: docTnd(data.tvaTnd) },
        ],
        { label: 'Total TTC', amount: docTnd(data.totalTtc) },
      ) +
      docNote(INVOICE_SETTLEMENT_NOTE),
  });

/** Rendered once by the month-end job and STORED (the chromium pipeline, lib/report/render). */
export const renderMonthlyInvoicePdf = (data: MonthlyInvoiceData): Promise<Buffer> =>
  renderPdf(buildMonthlyInvoiceHtml(data));
