import { TVA_RATE } from './facture.js';
import {
  docLines,
  docNote,
  docParties,
  docSignature,
  docTnd,
  docTotals,
  renderDocHtml,
} from './pdf-doc/document.js';
import { monthLabelFr } from './report/monthly-job.js';
import { renderPdf } from './report/render.js';

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
  /** Σ sh_amount_tnd for that source in the month — TTC (SH-TTC1). */
  amountTtcTnd: number;
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

const formatIssuedAt = (d: Date): string =>
  `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;

/**
 * The screenhost facture's HTML — the report's charter on white paper (the owner prints, signs,
 * stamps and returns it), the real logo, and a signature/stamp box (operator 2026-10-09).
 */
export const buildScreenhostFactureHtml = (data: ScreenhostFactureData): string =>
  renderDocHtml({
    paper: 'light',
    kicker: 'Facture',
    title: data.venueName,
    meta: [
      { label: 'Référence', value: data.reference },
      { label: 'Période', value: monthLabelFr(data.month) },
      { label: "Date d'émission", value: formatIssuedAt(data.issuedAt) },
    ],
    body:
      // The two party blocks, side by side — THE direction, stated plainly.
      docParties([
        { label: 'Émetteur', name: data.venueName, lines: [data.ownerName] },
        {
          label: 'Client',
          name: TOODOOH_CLIENT_NAME,
          lines: ["Réseau d'affichage DOOH — Tunisie"],
        },
      ]) +
      docLines(
        { label: 'Désignation', amount: 'Montant TTC' },
        data.lines.map((line) => ({
          label: sourceLabelFr(line.source),
          amount: docTnd(line.amountTtcTnd),
        })),
      ) +
      docTotals(
        [
          { label: 'Sous-total HT', amount: docTnd(data.subtotalHtTnd) },
          { label: `TVA (${Math.round(TVA_RATE * 100)} %)`, amount: docTnd(data.tvaTnd) },
        ],
        { label: 'Total TTC', amount: docTnd(data.totalTtcTnd) },
      ) +
      // The consigne — what the owner must DO with this document — and where to sign/stamp it.
      docNote(CONSIGNE_LINE) +
      docSignature(
        'Visa de l’établissement',
        'Lu et approuvé — signature et cachet de l’établissement.',
      ),
  });

/** Rendered once by the month-end sweep and STORED — the chromium pipeline (lib/report/render). */
export const renderScreenhostFacturePdf = (data: ScreenhostFactureData): Promise<Buffer> =>
  renderPdf(buildScreenhostFactureHtml(data));
