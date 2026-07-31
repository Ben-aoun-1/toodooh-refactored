import { TVA_RATE, ttcFromHt } from '@/lib/money';

import type { OwnerFactureRow } from '../services/factures.service';

// REV2 — the ONE home of the owner facture view model. The list, the detail screen and the deposit
// popup all read their numbers, labels and orderings from here, so the three surfaces cannot drift
// apart and so every rule below is testable: apps/web has no render harness (vitest runs
// `environment: 'node'` over `src/**/*.test.ts`), which makes a pure module the only place a rule
// can actually be pinned rather than merely written down in JSX.
//
// TWO RULES THIS FILE EXISTS TO ENFORCE.
//
//   §1 — NO INTERNALS, EVER. A screenhost sees the money they earned and nothing about how it was
//   computed: no CPM, no reversement split, no barème, no SPS score. This is not cosmetic. The
//   relevé this document replaces printed « Part établissement (50 %) … conformément au barème de
//   reversement Toodooh » on every owner's copy, and shipped that way since FCT2. The api-side
//   template is now pinned clean by a rendered-text extraction; these projections are pinned clean
//   by a source scan. Neither side may reintroduce a rate, a share or a score.
//
//   §5 — NO STATUS ON A LINE. The facture lifecycle (emise → en_verification → … → payee) is data.
//   A screenhost learns it moved through a NOTIFICATION, never a badge in a list. The owner wire
//   carries no `status` at all, which is what makes this enforceable rather than a convention: there
//   is nothing here to render even by accident.

/** The client block is fixed — Toodooh is always the party being billed on this document. */
export const TOODOOH_CLIENT_NAME = 'TOODOOH';
export const TOODOOH_CLIENT_SUBTITLE = "Réseau d'affichage DOOH — Tunisie";

/** What the owner must DO with the document — mirrors the PDF's own consigne, word for word. */
export const CONSIGNE_LINE =
  'Merci d’imprimer, signer, cacheter et renvoyer ce document via la section « Déposer votre facture signée ».';

/** Stated in the deposit UI because it is the api's structural behaviour, not a warning. */
export const REPLACE_NOTICE = 'Le dernier fichier déposé remplace le précédent.';

/** « TVA (19 %) » — the rate is read from lib/money, the single home. Never re-declared here. */
export const TVA_LABEL = `TVA (${Math.round(TVA_RATE * 100)} %)`;

export interface FactureMoney {
  htTnd: number;
  tvaTnd: number;
  ttcTnd: number;
}

/**
 * The money trio from the one HT figure the wire carries.
 *
 * `total_sh_tnd` IS the facture's sous-total HT — the sweep stores Σ sh_amount_tnd and hands that
 * same number to the PDF as `subtotalHtTnd`. TTC rides `lib/money`'s `ttcFromHt` (identical
 * implementation to the api's, by explicit convention), and TVA is the difference rather than a
 * second independent computation, so the three figures always add up on screen exactly as they do
 * on the printed document.
 */
export const factureMoney = (totalShTnd: number): FactureMoney => {
  const htTnd = totalShTnd;
  const ttcTnd = ttcFromHt(htTnd);
  return { htTnd, tvaTnd: Math.round((ttcTnd - htTnd) * 100) / 100, ttcTnd };
};

export interface FactureLine {
  label: string;
  amountHtTnd: number;
}

/** The neutral wording, for a source the document cannot name. Mirrors the api's own fallback. */
export const SOURCE_LABEL_FALLBACK = 'Revenus de diffusion';

/**
 * French label per reversement source — the same words the PDF prints, because the screen and the
 * PDF are two renderings of ONE invoice and « Imprimer » turns this screen into the second one.
 */
export const sourceLabelFr = (source: string): string => {
  if (source === 'event') return 'Revenus de diffusion — événements';
  if (source === 'campaign') return 'Revenus de diffusion — campagnes';
  return SOURCE_LABEL_FALLBACK;
};

/**
 * The revenue lines the detail screen prints, from the detail wire's per-source breakdown.
 *
 * REV2 commit 3 put these on the wire. Before it, the owner projection carried only `total_sh_tnd`
 * while the PDF printed the split — so « Imprimer » and « Télécharger PDF » produced two different
 * documents for one invoice. Both now originate in the api's single computation home
 * (lib/facture-lines), so what the owner signs on paper says what the screen said.
 *
 * THE FALLBACK IS FOR ZERO LINES ONLY. A facture whose breakdown can no longer be derived still
 * shows its stored HT under the neutral wording — the total on screen never stops matching the
 * document. It is a degraded render, never an invented split.
 */
export const factureLines = (detail: {
  total_sh_tnd: number;
  lines: readonly { source: string; amount_ht_tnd: number }[];
}): FactureLine[] =>
  detail.lines.length === 0
    ? [{ label: SOURCE_LABEL_FALLBACK, amountHtTnd: detail.total_sh_tnd }]
    : detail.lines.map((l) => ({ label: sourceLabelFr(l.source), amountHtTnd: l.amount_ht_tnd }));

export interface FactureDepositEntry {
  id: string;
  /** « Facture <Mois> <Année> » — the same words the list and the popup use. */
  designation: string;
  venueName: string;
  depositedAt: string;
}

/**
 * The « dépôts précédents » list: NAME AND DATE, nothing else (§5 — a status here would be exactly
 * the badge the rule forbids). `deposited_at` is the only deposit signal the wire carries, which is
 * why a deposited facture is simply one that has a date. Newest first.
 */
export const depositHistory = (rows: readonly OwnerFactureRow[]): FactureDepositEntry[] =>
  rows
    .filter((r): r is OwnerFactureRow & { deposited_at: string } => r.deposited_at !== null)
    .map((r) => ({
      id: r.id,
      designation: r.designation,
      venueName: r.screenhost_name,
      depositedAt: r.deposited_at,
    }))
    .sort((a, b) => b.depositedAt.localeCompare(a.depositedAt));

/**
 * What the « Choisir la facture concernée » popup offers. Every facture the owner has, by name —
 * including ones already deposited, because re-depositing is a supported path, not an error.
 */
export interface FactureChoice {
  id: string;
  designation: string;
  venueName: string;
  reference: string;
}

export interface DepositPayload {
  id: string;
  file: File;
}

/**
 * What the popup will actually send.
 *
 * The facture id comes from the owner's step-1 answer, NEVER from the drop event — a file dropped
 * without that answer would have to be guessed onto a month, and guessing wrong attaches a signed,
 * stamped document to the wrong facture. Returning null when either half is missing is what makes
 * « the file attaches to THAT facture » structural: there is no code path that uploads against an
 * id the owner did not pick.
 */
export const depositPayload = (
  selectedId: string | null,
  file: File | undefined,
): DepositPayload | null => (selectedId && file ? { id: selectedId, file } : null);

export const factureChoices = (rows: readonly OwnerFactureRow[]): FactureChoice[] =>
  rows.map((r) => ({
    id: r.id,
    designation: r.designation,
    venueName: r.screenhost_name,
    reference: r.reference,
  }));

const tnd = new Intl.NumberFormat('fr-TN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** « 1 234,50 TND » — the owner-side montant format (revenue surfaces stay plain, CF-U1). */
export const formatTnd = (value: number): string => `${tnd.format(value)} TND`;

/** « 31/07/2026 » from an ISO instant; an unparseable value is echoed rather than faked. */
export const formatDateFr = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
};
