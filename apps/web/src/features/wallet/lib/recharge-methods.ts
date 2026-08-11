// FCT1 — recharge parcours v2, the pure half: the TWO manual methods, the per-method French
// status labels (chips), the amount gate (min 500) and the « Pour info » bank-coordinates rules.
// ONE home shared by the screencaster surfaces (MyRecharges) AND the admin queue (RechargeManagement
// imports from here — the walletKeys precedent), so the label matrix can't drift between the two.

export type RechargeMethod = 'virement' | 'bon_de_commande';

export type RechargeStatus = 'pending' | 'confirmed' | 'rejected' | 'bon_issued' | 'bon_returned';

/** Mirrors the server's MIN_RECHARGE_TND (lib/recharges.ts) — a client pre-check, never the authority. */
export const MIN_RECHARGE_TND = 500;

export const AMOUNT_MIN_ERROR = 'Le montant minimum est de 500 TND';
export const JUSTIFICATIF_REQUIRED_ERROR = 'Le justificatif de virement est obligatoire.';

/**
 * Parse the montant input. null = invalid (empty, non-numeric, under the 500 floor or more than
 * 2 decimals — TND centime precision, the server mirror).
 */
export const parseRechargeAmount = (raw: string): number | null => {
  const amount = Number.parseFloat(raw);
  if (!Number.isFinite(amount)) return null;
  if (amount < MIN_RECHARGE_TND) return null;
  if (Number(amount.toFixed(2)) !== amount) return null;
  return amount;
};

export const METHOD_LABELS: Record<RechargeMethod, string> = {
  virement: 'Virement bancaire',
  bon_de_commande: 'Bon de commande',
};

/** The admin Type column — legacy rows (method NULL) render « — », as-found. */
export const methodLabel = (method: RechargeMethod | null): string =>
  method === null ? '—' : METHOD_LABELS[method];

// The per-method status label matrix (US-FCT-8) — the v2 sets REPLACE En attente/Validée for
// method rows; legacy rows keep their as-found labels. One lookup so every chip site agrees.
const LEGACY_STATUS_LABELS: Record<RechargeStatus, string> = {
  pending: 'En attente',
  confirmed: 'Validée',
  // GREEN2 item 6 — ONE refusal word for recharges, aligned with the modal verb « Annuler la
  // demande »: legacy rows join virement/bon on « Annulée ». (Factures keep « Refuser » — a
  // different spec family, untouched.)
  rejected: 'Annulée',
  // Unreachable for legacy rows (the bon states require method='bon_de_commande') — mapped anyway
  // so the record is total and a drifted row still renders something sensible.
  bon_issued: 'Bon émis',
  bon_returned: 'Bon retourné signé',
};

const VIREMENT_STATUS_LABELS: Record<RechargeStatus, string> = {
  ...LEGACY_STATUS_LABELS,
  pending: 'En attente de réception',
  confirmed: 'Créditée',
  rejected: 'Annulée',
};

const BON_STATUS_LABELS: Record<RechargeStatus, string> = {
  ...LEGACY_STATUS_LABELS,
  confirmed: 'Fonds reçus',
  rejected: 'Annulée',
};

export const statusLabel = (method: RechargeMethod | null, status: RechargeStatus): string => {
  if (method === 'virement') return VIREMENT_STATUS_LABELS[status];
  if (method === 'bon_de_commande') return BON_STATUS_LABELS[status];
  return LEGACY_STATUS_LABELS[status];
};

/** Chip styling by raw status — method-independent (the label carries the method nuance). */
export const statusChipClass = (status: RechargeStatus): string => {
  switch (status) {
    case 'confirmed':
      return 'bg-green-100 text-green-800 border-green-200';
    case 'rejected':
      return 'bg-red-100 text-red-800 border-red-200';
    case 'bon_issued':
      return 'bg-blue-100 text-blue-800 border-blue-200';
    case 'bon_returned':
      return 'bg-indigo-100 text-indigo-800 border-indigo-200';
    case 'pending':
      return 'bg-yellow-100 text-yellow-800 border-yellow-200';
  }
};

/** Every display label the admin status filter offers (deduped, fixed order). */
export const ADMIN_STATUS_FILTER_LABELS: readonly string[] = [
  'En attente',
  'En attente de réception',
  // GREEN2 (ruled) — outstanding awaiting-signature bons are VISIBLE (read-only) in the queue.
  'Bon émis',
  'Bon retourné signé',
  'Validée',
  'Créditée',
  'Fonds reçus',
  'Annulée',
];

/**
 * The admin-decidable mirror (lib/recharges.ts isAdminDecidable): Valider/Annuler show on a
 * virement (or legacy) row while pending, on a bon row only once the signed bon is back.
 * GREEN2 — « Bon émis » rows now APPEAR in the queue (read-only); this predicate is what keeps
 * their action buttons off until the signed bon is deposited.
 */
export const isAdminDecidable = (row: {
  method: RechargeMethod | null;
  status: RechargeStatus;
}): boolean =>
  row.method === 'bon_de_commande' ? row.status === 'bon_returned' : row.status === 'pending';

// ── the « Pour info » bank-coordinates block (US-FCT-3) ──────────────────────
export interface BankCoordinates {
  rib: string;
  iban: string;
  bic: string;
  domiciliation: string;
}

/** The server's not-provisioned placeholder ('—' — an unset dispatch_config.bank_* column). */
export const BANK_COORDS_PLACEHOLDER = '—';

export const BANK_COORDS_PENDING_LINE = 'Coordonnées bancaires communiquées prochainement.';

/** Provisioned = at least one real value; an all-placeholder quartet shows the pending line. */
export const bankCoordsProvided = (coords: BankCoordinates): boolean =>
  [coords.rib, coords.iban, coords.bic, coords.domiciliation].some(
    (v) => v.trim() !== '' && v !== BANK_COORDS_PLACEHOLDER,
  );
