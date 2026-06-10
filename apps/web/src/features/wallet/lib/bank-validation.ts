// TN bank-coordinate formats (commit-1 ruling) — the single source both bank forms
// (OwnerBankDetailsSlot, OwnerRevenue modal) validate against, mirroring the backend
// zod on PATCH /api/profile/bank: RIB = exactly 20 digits; IBAN = "TN" + 22 digits
// (24 chars — check digits not pinned).

export const RIB_ERROR = 'RIB invalide (exactement 20 chiffres).';
export const IBAN_ERROR = 'IBAN invalide (TN suivi de 22 chiffres).';

export const isValidRib = (value: string): boolean => /^\d{20}$/.test(value);
export const isValidIban = (value: string): boolean => /^TN\d{22}$/.test(value);

/** Input normalization: strip spaces (RIB/IBAN are often typed grouped) + uppercase. */
export const normalizeBankInput = (value: string): string =>
  value.replace(/\s+/g, '').toUpperCase();
