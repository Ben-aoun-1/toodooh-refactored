// R7/N4 (reversed by Kais QA 2026-06-24) — the owner signup document volets the wizard collects +
// sends as multipart. Documents are OPTIONAL at signup (provide-later): these helpers are a
// COMPLETENESS signal (mirrors the server's documentPresence) used only for a NON-BLOCKING hint —
// they no longer gate submit.
//
// SIGN-2 (operator ruling 2026-08-31) — the CIN intake is REMOVED FROM SIGNUP. individual_owner is
// now asked for the RIB only; fleet_owner keeps RNE + RIB; advertisers/agencies submit nothing.
// CIN is not abolished, it becomes PROVIDE-LATER: the 'cin' document category, the CorrectDocuments
// cin branch and the admin request path are all untouched, so an admin can still ask for it and the
// owner still uploads it post-signin through /api/profile/documents.
export interface OwnerVoletFiles {
  rne: File | null;
  bank: File | null;
}

export const emptyOwnerVolets = (): OwnerVoletFiles => ({
  rne: null,
  bank: null,
});

// The volet fields not yet provided for this profile (empty = a complete set). The names match the
// server's multipart parts (rne/bank). Non-owner profiles need no documents.
// Informational only — a non-empty result no longer blocks signup (docs are optional, provide-later).
export const missingOwnerVolets = (
  profileType: string | undefined,
  files: OwnerVoletFiles,
): string[] => {
  const missing: string[] = [];
  if (profileType === 'individual_owner') {
    if (!files.bank) missing.push('bank'); // SIGN-2 — the RIB is all signup asks of an individual
  } else if (profileType === 'fleet_owner') {
    if (!files.rne) missing.push('rne');
    if (!files.bank) missing.push('bank');
  }
  return missing;
};

export const ownerVoletsComplete = (
  profileType: string | undefined,
  files: OwnerVoletFiles,
): boolean => missingOwnerVolets(profileType, files).length === 0;
