// R7/N4 — the owner signup document volets the wizard collects + sends as multipart (mirrors the C5
// backend contract). individual_owner: CIN recto + verso (volet 1) + RIB/bank (volet 2). fleet_owner:
// RNE (volet 1) + RIB/bank (volet 2). Advertisers/agencies submit no documents at signup. The client
// validation here mirrors the server so submit is blocked until the mandatory volets are present.
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

// The volet fields still missing for this profile (empty = ready to submit). The names match the
// server's multipart parts (cin_recto/cin_verso/rne/bank). Non-owner profiles require no documents.
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
