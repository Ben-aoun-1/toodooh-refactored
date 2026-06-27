// R7/N4 (reversed by Kais QA 2026-06-24) — the owner signup document volets the wizard collects +
// sends as multipart. individual_owner: CIN recto + verso (volet 1) + RIB/bank (volet 2). fleet_owner:
// RNE (volet 1) + RIB/bank (volet 2). Advertisers/agencies submit no documents at signup. Documents
// are OPTIONAL at signup now (provide-later): these helpers are a COMPLETENESS signal (mirrors the
// server's documentPresence) used only for a NON-BLOCKING hint — they no longer gate submit.
export interface OwnerVoletFiles {
  cinRecto: File | null;
  cinVerso: File | null;
  rne: File | null;
  bank: File | null;
}

export const emptyOwnerVolets = (): OwnerVoletFiles => ({
  cinRecto: null,
  cinVerso: null,
  rne: null,
  bank: null,
});

// The volet fields not yet provided for this profile (empty = a complete set). The names match the
// server's multipart parts (cin_recto/cin_verso/rne/bank). Non-owner profiles need no documents.
// Informational only — a non-empty result no longer blocks signup (docs are optional, provide-later).
export const missingOwnerVolets = (
  profileType: string | undefined,
  files: OwnerVoletFiles,
): string[] => {
  const missing: string[] = [];
  if (profileType === 'individual_owner') {
    if (!files.cinRecto) missing.push('cin_recto');
    if (!files.cinVerso) missing.push('cin_verso');
    if (!files.bank) missing.push('bank');
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
