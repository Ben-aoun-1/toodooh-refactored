import type { BusinessProfile } from '@/features/auth/types/auth';

/**
 * "Pour bien commencer" gating (F5 — Kais QA 2026-06-11), extracted from OwnerDashboard so the
 * dismissal is testable as pure logic. The block hides only when all three predicates hold.
 * Pure: no I/O, no state.
 */

// Reads /api/me's `documents` booleans (OwnerSettings precedent). The legacy
// cin_doc_url/registration_doc_* fields are never set by the /api/me bridge — reading them kept
// the block permanently visible for owners whose documents were already on file.
// CIN-2 (Mejri 09/09, operator 2026-09-12): the CIN is removed — an individual owner has NO legal
// document to file, so the predicate holds for them outright; companies still need the RNE.
export function hasOwnerLegalDocument(profile: BusinessProfile | null): boolean {
  if (!profile) return false;
  if (profile.profile_type === 'individual_owner') return true;
  return Boolean(profile.documents?.registration);
}

// Verbatim from OwnerDashboard — bank_doc_path is synthesized by getBusinessProfile from
// documents.bank, so this predicate was never broken.
export function hasOwnerBankDetails(profile: BusinessProfile | null): boolean {
  return Boolean(
    profile?.bank_account_holder &&
    profile?.bank_rib &&
    profile?.bank_iban &&
    (profile?.bank_doc_path || profile?.bank_doc_url),
  );
}

export function isOwnerAccountActive(
  profile: BusinessProfile | null,
  validationStatus: string | undefined,
): boolean {
  return validationStatus === 'approved' && profile?.is_active !== false;
}

export function hideOwnerGettingStarted(
  profile: BusinessProfile | null,
  validationStatus: string | undefined,
): boolean {
  return (
    hasOwnerLegalDocument(profile) &&
    hasOwnerBankDetails(profile) &&
    isOwnerAccountActive(profile, validationStatus)
  );
}
