// REV3 — the admin « Factures Screenhost » status vocabulary and its CONTEXTUAL ACTION MATRIX.
//
// This is a pure module because apps/web has no render harness (vitest runs environment: 'node'
// over src/**/*.test.ts): a matrix left inline in JSX is a matrix nobody can test, and this one
// decides which money-moving buttons an admin is offered. It mirrors the api's guard exactly — the
// api is the authority and 409s anything out of matrix, so a divergence here shows a button that
// cannot work rather than performing an illegal transition.
//
// THE STATUS PILL LIVES ON THE ADMIN SIDE AND ONLY THERE. §5 forbids a status on an OWNER surface;
// the admin table is the single stated exception in the whole product.

export type FactureStatut = 'emise' | 'en_verification' | 'en_paiement' | 'refusee' | 'payee';

export const FACTURE_STATUTS: FactureStatut[] = [
  'emise',
  'en_verification',
  'en_paiement',
  'refusee',
  'payee',
];

/** The French the admin reads. « En cours de paiement » is the spec's wording, not « en paiement ». */
export const FACTURE_STATUT_LABEL: Record<FactureStatut, string> = {
  emise: 'Émise',
  en_verification: 'En vérification',
  en_paiement: 'En cours de paiement',
  refusee: 'Facture refusée',
  payee: 'Payée',
};

/** The pill's colours — the recharge-management chip idiom (rounded-full + border). */
export const FACTURE_STATUT_CHIP: Record<FactureStatut, string> = {
  emise: 'bg-gray-100 text-gray-800 border-gray-200',
  en_verification: 'bg-amber-100 text-amber-800 border-amber-200',
  en_paiement: 'bg-blue-100 text-blue-800 border-blue-200',
  refusee: 'bg-red-100 text-red-800 border-red-200',
  payee: 'bg-emerald-100 text-emerald-800 border-emerald-200',
};

export const factureStatutLabel = (statut: string): string =>
  FACTURE_STATUT_LABEL[statut as FactureStatut] ?? statut;

export const factureStatutChip = (statut: string): string =>
  FACTURE_STATUT_CHIP[statut as FactureStatut] ?? 'bg-gray-100 text-gray-800 border-gray-200';

export type FactureAction = 'voir' | 'valider' | 'refuser' | 'marquer-payee' | 'paper';

/** What the admin is offered on a row, and the French on the button. */
export const FACTURE_ACTION_LABEL: Record<FactureAction, string> = {
  voir: 'Voir',
  valider: 'Valider',
  refuser: 'Refuser',
  'marquer-payee': 'Marquer payée',
  paper: 'Marquer payée (papier)',
};

/**
 * The contextual actions for one row — the client mirror of the api's transition matrix.
 *
 *   voir           whenever a signed document exists (any status: a paid facture's document is
 *                  still the thing that was paid, and the admin must be able to re-open it)
 *   valider        en_verification only
 *   refuser        en_verification only
 *   marquer-payee  en_paiement only
 *   paper          emise AND never deposited — a facture that WAS deposited has a document waiting
 *                  to be checked, and the paper path would skip that check
 *
 * Order is fixed so the primary action never moves under the cursor between rows.
 */
export const actionsForFacture = (row: {
  status: string;
  deposited_at: string | null;
}): FactureAction[] => {
  const actions: FactureAction[] = [];
  if (row.deposited_at !== null) actions.push('voir');
  if (row.status === 'en_verification') actions.push('valider', 'refuser');
  if (row.status === 'en_paiement') actions.push('marquer-payee');
  if (row.status === 'emise' && row.deposited_at === null) actions.push('paper');
  return actions;
};

/**
 * The confirm the paper action must state before it runs.
 *
 * It is not a "are you sure" — it names the CONSEQUENCE. This single click pays the facture AND
 * writes a versement line into the owner's history, which is irreversible; an admin who thought
 * they were only changing a status would be wrong.
 */
export const PAPER_CONFIRM_MESSAGE =
  'Cette facture sera marquée payée et un versement sera inscrit dans l’historique du screenhost. Cette action est irréversible.';

/** A refusal motif the api will accept: trimmed and non-empty. Mirrors the route's zod. */
export const isValidMotif = (motif: string): boolean => motif.trim().length > 0;

export const MOTIF_REQUIRED_ERROR = 'Un motif est requis pour refuser une facture.';
