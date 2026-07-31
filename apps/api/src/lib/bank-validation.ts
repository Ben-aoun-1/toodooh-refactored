// Tunisian bank-coordinate formats — the ONE api home. Before REV1 these regexes lived inline in
// routes/profile.ts's zod schema and were duplicated (independently) in the web bundle; the shapes
// agreed by luck, not by construction. Route zod now composes THESE.
//
// THE RULING (delivered in a previous lane, re-pinned here by REV1's matrix):
//   RIB  — exactly 20 characters, digits only.
//   IBAN — exactly 24 characters: 'TN' + 22 digits (2 check digits, then the 20 RIB digits).
//          No letter after the prefix; the prefix is uppercase 'TN' exactly.
//
// TWO DECISIONS PINNED, both deliberate, both V1:
//
//  1. The IBAN check digits are NOT arithmetically verified (no ISO 7064 mod-97). A structurally
//     valid IBAN with wrong check digits is ACCEPTED. Verifying them is a real improvement and is
//     deliberately deferred — it would reject coordinates the bank itself would honour if the
//     owner mistyped a check digit, and V1 favours not blocking a payout setup.
//
//  2. Cross-consistency between the RIB and the IBAN's 20-digit tail is NOT enforced. A Tunisian
//     IBAN embeds the RIB (TN + 2 check digits + the 20 RIB digits), so a conforming pair agrees —
//     but the spec does not require the check, and rejecting a mismatch would be inventing a rule.
//     A mismatched pair is ACCEPTED. If that is ever wanted it is a product decision, not a bug fix.
//
// French messages: these reach the owner directly on « Mes Revenus ».

export const RIB_LENGTH = 20;
export const IBAN_LENGTH = 24;

export const RIB_ERROR = 'RIB invalide (exactement 20 chiffres).';
export const IBAN_ERROR = 'IBAN invalide (TN suivi de 22 chiffres).';

const RIB_PATTERN = /^[0-9]{20}$/;
// Anchored + digit-only after the prefix: 'TN' followed by anything non-numeric fails, and the
// uppercase literal makes a lowercase 'tn' fail without a separate branch.
const IBAN_TN_PATTERN = /^TN[0-9]{22}$/;

/** Exactly 20 digits. Rejects 19, 21, any letter, spaces, and the empty string. */
export const validateRib = (value: string): boolean => RIB_PATTERN.test(value);

/** Exactly 24 chars: uppercase 'TN' + 22 digits. Rejects lowercase 'tn' and any letter in the tail. */
export const validateIbanTn = (value: string): boolean => IBAN_TN_PATTERN.test(value);
