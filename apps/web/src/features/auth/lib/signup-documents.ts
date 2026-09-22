import type { SignUpData } from '@/features/auth/types/auth';

// The documents a signup carries to POST /api/signup, and the multipart body that carries them — the
// web twin of apps/api lib/signup-documents.ts.
// • Owners (R7/N4, CIN-2b; RNE-SIGN1): ALWAYS multipart — a `payload` field (the accepted-fields JSON)
//   + the RNE volet as `rne` and the RIB volet as `bank`, each only when picked.
// • Screencasters — advertiser and agency (DOC-CAST1, ruling A 2026-09-22): the « Documents » step's
//   RNE (≤ 2) and documents complémentaires (≤ 10) used to be dropped here (the old F5 « no documents
//   at signup » rule), so they never reached admin. Now every pick rides the SAME multipart shape: one
//   `rne` part per RNE, one `complementaire` part per complémentaire. No file → plain JSON.
// Files never enter `payload`: the caller builds it from scalar fields only.

type SignupProfileType = SignUpData['profile_type'];

const isOwnerProfile = (profileType: SignupProfileType): boolean =>
  profileType === 'individual_owner' || profileType === 'fleet_owner';

interface ScreencasterPicks {
  profileType: SignupProfileType;
  rneFiles: File[];
  complementaireFiles: File[];
  /** « J'ajouterai mes documents plus tard » is ticked. */
  addLater: boolean;
}

/** The « Documents » step's picks as SignUpData carries them: none for an owner or « plus tard ». */
export const screencasterSignupDocuments = ({
  profileType,
  rneFiles,
  complementaireFiles,
  addLater,
}: ScreencasterPicks): Pick<SignUpData, 'rne_docs' | 'complementaire_docs'> => {
  if (isOwnerProfile(profileType)) return {};
  if (addLater) return { rne_docs: [], complementaire_docs: [] };
  return { rne_docs: [...rneFiles], complementaire_docs: [...complementaireFiles] };
};

type FilePart = [name: string, file: File];

// Owner volets: the RNE as `rne`, the RIB as `bank` — each only when picked (never an empty part).
const ownerParts = ({ registration_doc, bank_doc }: SignUpData): FilePart[] => {
  const parts: FilePart[] = [];
  if (registration_doc) parts.push(['rne', registration_doc]);
  if (bank_doc) parts.push(['bank', bank_doc]);
  return parts;
};

// Screencaster picks: one part per file, RNE first, in pick order.
const screencasterParts = ({ rne_docs = [], complementaire_docs = [] }: SignUpData): FilePart[] => [
  ...rne_docs.map((file): FilePart => ['rne', file]),
  ...complementaire_docs.map((file): FilePart => ['complementaire', file]),
];

/** The multipart body of the signup, or `null` when it posts plain JSON. */
export const signupFormData = (payload: object, data: SignUpData): FormData | null => {
  const owner = isOwnerProfile(data.profile_type);
  const parts = owner ? ownerParts(data) : screencasterParts(data);
  // An owner posts multipart even with no volet (unchanged since R7/N4); a screencaster only with one.
  if (!owner && parts.length === 0) return null;
  const form = new FormData();
  form.append('payload', JSON.stringify(payload));
  for (const [name, file] of parts) form.append(name, file);
  return form;
};
