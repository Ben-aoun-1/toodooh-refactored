/**
 * THE matricule fiscal definition. Operator ruling 2026-08-31, superseding the Q6 lenient
 * fallback this file itself named as the deferred Phase-1c tightening.
 *
 * SHAPE: 7 digits + 3 letters + 3 digits. `/` and spaces are OPTIONAL SEPARATORS — they are
 * stripped on input — and the value is stored UPPERCASE, so `1234567/A/M/M/000`,
 * `"1234567 A M M 000"` and `1234567amm000` are three spellings of ONE canonical string,
 * `1234567AMM000`.
 *
 * VALIDATE ON INPUT ONLY. Nothing here may be pointed at a STORED value:
 *   • no re-validation of what is already in the column,
 *   • no edit blocked because a legacy value predates this format,
 *   • no backfill, no migration.
 * The DB CHECK stays on its lenient legacy pattern `^[A-Za-z0-9/]{7,20}$` for exactly that
 * reason — a canonical `1234567AMM000` satisfies it, and so does every legacy value, so admins
 * can still edit older profiles. Tightening the CHECK would be the migration the ruling forbids.
 *
 * ONE DEFINITION, shared with apps/web: `features/auth/utils/tax-number.ts` mirrors this file,
 * and its test READS THIS FILE FROM DISK and asserts the block below is byte-identical, so the
 * two cannot drift (the ev1-pins technique). See the PR for why a `packages/shared` workspace
 * package was not created inside this lane.
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
