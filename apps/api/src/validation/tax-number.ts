// Q6 verification (plan-time, ratified): THREE authoritative project sources
// all enforce non-empty only, NO format — legacy schema §2.2 (NOT NULL UNIQUE,
// no CHECK), apps/web (.trim() only, OwnerSettings.tsx:274), and the legacy
// validation fn (fix-business-profiles.sql:40 "cannot be null or empty"). Zero
// sample tax_number values exist to validate a pattern, and the official DGI
// matricule fiscal format is non-trivial/variable and unverifiable. Per the Q6
// ruling, real uncertainty → lenient fallback. Strict matricule validation is
// deferred to Phase 1c onboarding (one isolated file to tighten later).
const TAX_NUMBER = /^[A-Za-z0-9/]{7,20}$/;

export const validateTaxNumber = (value: string): boolean => TAX_NUMBER.test(value);
