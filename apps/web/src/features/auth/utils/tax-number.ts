/**
 * THE matricule fiscal definition — the web MIRROR of apps/api/src/validation/tax-number.ts
 * (operator ruling 2026-08-31). The block below is BYTE-IDENTICAL to the api's; `tax-number.test.ts`
 * reads the api file from disk and asserts it, so the two copies cannot drift apart.
 *
 * Shape: 7 digits + 3 letters + 3 digits; `/` and spaces are optional separators stripped on
 * input; the canonical form is upper-case. VALIDATE ON INPUT ONLY — never against a stored value,
 * so a legacy matricule can still be edited.
 */

// ── shared block: keep byte-identical with apps/web/src/features/auth/utils/tax-number.ts ──
const TAX_NUMBER_SEPARATORS = /[\s/]+/g;
const TAX_NUMBER_CANONICAL = /^\d{7}[A-Z]{3}\d{3}$/;

/** Strip the optional separators and upper-case — the ONE canonical form that gets stored. */
export const normalizeTaxNumber = (value: string): string =>
  value.replace(TAX_NUMBER_SEPARATORS, '').toUpperCase();

/** INPUT validation: does this spelling normalise to a well-formed matricule? */
export const validateTaxNumber = (value: string): boolean =>
  TAX_NUMBER_CANONICAL.test(normalizeTaxNumber(value));

export const TAX_NUMBER_ERROR =
  'Matricule invalide : 7 chiffres, 3 lettres, 3 chiffres (ex. 1234567/A/M/M/000).';
// ── end shared block ──
