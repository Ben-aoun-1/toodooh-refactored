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

/**
 * The revenue lines the detail screen prints.
 *
 * ⚠️ THE SPLIT IS NOT ON THE WIRE. The sweep groups reversement lines BY SOURCE and the PDF prints
 * « Revenus de diffusion — campagnes » and « — événements » separately, but the owner list
 * projection (GET /api/screenhosts/statements) carries only `total_sh_tnd`. Showing the split on
 * this screen requires an api change, which REV2 commit 2 is forbidden from making.
 *
 * So we print ONE line at the exact facture HT, under the api's own neutral wording for a source it
 * cannot name (`sourceLabelFr`'s fallback). The total on screen therefore always equals the total on
 * the PDF. The alternative — deriving a split from GET /screenhosts/earnings — was rejected: that
 * endpoint reports campaign reconciliation payouts, not month-settled reversement lines, so its
 * figures would disagree with the document the owner is being asked to sign.
 */
export const SOURCE_LABEL_FALLBACK = 'Revenus de diffusion';

export const factureLines = (row: Pick<OwnerFactureRow, 'total_sh_tnd'>): FactureLine[] => [
  { label: SOURCE_LABEL_FALLBACK, amountHtTnd: row.total_sh_tnd },
];

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
