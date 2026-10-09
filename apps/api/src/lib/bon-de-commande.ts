import { TVA_RATE, ttcFromHt, tvaFromHt } from './facture.js';
import {
  docLines,
  docNote,
  docParties,
  docSignature,
  docTnd,
  docTotals,
  renderDocHtml,
} from './pdf-doc/document.js';
import { renderPdf } from './report/render.js';

// FCT1 (US-FCT-5/6) — the auto-generated « bon de commande » PDF for the bon_de_commande recharge
// method: identity + montant + BC-reference + a signature block, French. Reuses the facture's
// TVA trio; operator 2026-10-09: the report's charter + the real logo (lib/pdf-doc), chromium. Unlike the facture (deterministic re-render, never stored) the bon IS
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

const formatIssuedAt = (d: Date): string => d.toISOString().slice(0, 10);

// The signature invite printed on the bon — exported so the route test can pin the chartered copy.
export const BON_SIGNATURE_MENTION =
  'Signature du client, précédée de la mention « Bon pour accord »';
export const BON_RETURN_INSTRUCTION =
  'À imprimer, signer et redéposer sur votre espace Toodooh (Recharge rapide).';

/** The bon's HTML — the report's charter on white paper (it is signed), the real logo. */
export const buildBonDeCommandeHtml = (data: BonDeCommandeData): string => {
  const ht = data.amountTnd;
  return renderDocHtml({
    paper: 'light',
    kicker: 'Bon de commande',
    title: 'Rechargement de compte',
    meta: [
      { label: 'Référence', value: data.reference },
      { label: 'Date', value: formatIssuedAt(data.issuedAt) },
    ],
    body:
      docParties([{ label: 'Client', name: data.advertiserName }]) +
      docLines({ label: 'Description', amount: 'Montant HT' }, [
        { label: 'Rechargement de compte (crédit publicitaire)', amount: docTnd(ht) },
      ]) +
      docTotals(
        [
          { label: 'Montant HT', amount: docTnd(ht) },
          { label: `TVA (${Math.round(TVA_RATE * 100)} %)`, amount: docTnd(tvaFromHt(ht)) },
        ],
        { label: 'Total TTC (à régler)', amount: docTnd(ttcFromHt(ht)) },
      ) +
      docNote(`Montant crédité au solde : ${docTnd(ht)} HT`) +
      docSignature('Bon pour accord', BON_SIGNATURE_MENTION) +
      docNote(BON_RETURN_INSTRUCTION),
  });
};

/** Rendered once at creation and STORED (byte-stable) — the chromium pipeline. */
export const renderBonDeCommandePdf = (data: BonDeCommandeData): Promise<Buffer> =>
  renderPdf(buildBonDeCommandeHtml(data));
