import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';

import { authKeys } from '@/features/auth/hooks/queryKeys';
import { useBusinessProfile } from '@/features/auth/hooks/useBusinessProfile';
import { useAuthStore } from '@/features/auth/stores/auth.store';
import OwnerBankDetailsSlot from '@/features/profile/components/OwnerBankDetailsSlot';
import ProfileDocumentsManager, {
  type DocumentCategoryConfig,
} from '@/features/profile/components/ProfileDocumentsManager';

// N3 Scenario 1 — the document-correction surface for a REJECTED account, reachable under the
// RejectedRoute gate (the normal /profile & /owner-settings surfaces bounce rejected users, C2). It
// REUSES the existing managers + endpoints (no new upload path): ProfileDocumentsManager (legal +
// complementaire) for everyone, and OwnerBankDetailsSlot (RIB, PATCH /api/profile/bank) for owners.
// After fixing, the user returns to /account-rejected to "Renvoyer pour révision".
export default function CorrectDocuments() {
  const userId = useAuthStore((s) => s.user?.id ?? '');
  const profileType = useAuthStore((s) => s.profileType);
  const queryClient = useQueryClient();
  const { profile, loading } = useBusinessProfile(userId);

  const isOwner = profileType === 'individual_owner' || profileType === 'fleet_owner';
  // Same categories /profile (advertiser) and /owner-settings (owner) pass: individual owners file a
  // CIN, everyone else an RNE; both add the optional "complémentaires".
  const docCategories: DocumentCategoryConfig[] = [
    profileType === 'individual_owner'
      ? { category: 'cin', title: "Carte d'identité nationale (CIN)" }
      : { category: 'rne', title: 'Registre de commerce (RNE)' },
    { category: 'complementaire', title: 'Documents complémentaires' },
  ];

  // Uploads/bank-saves flip /api/me's document booleans + bank fields; refresh the profile query so
  // the bank slot re-prefills and the user stays on this page (no dashboard bounce).
  const invalidateProfile = () =>
    void queryClient.invalidateQueries({ queryKey: authKeys.profile(userId) });

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-10">
      <div className="mx-auto max-w-3xl">
        <Link
          to="/account-rejected"
          className="mb-6 inline-flex items-center gap-2 text-sm text-gray-600 transition-colors hover:text-gray-900"
        >
          <ArrowLeft className="h-4 w-4" /> Retour
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">Corriger mes documents</h1>
        <p className="mt-2 text-sm text-gray-600">
          Corrigez les documents signalés, puis revenez pour renvoyer votre dossier en révision.
        </p>

        <div className="mt-6 overflow-hidden rounded-2xl border border-gray-200 bg-white">
          <ProfileDocumentsManager categories={docCategories} onChanged={invalidateProfile} />
        </div>

        {isOwner ? (
          loading ? (
            <div className="mt-6 rounded-2xl border border-gray-200 bg-white p-6 text-sm text-gray-600">
              Chargement des coordonnées bancaires…
            </div>
          ) : profile ? (
            <div className="mt-6 overflow-hidden rounded-2xl border border-gray-200 bg-white">
              <OwnerBankDetailsSlot
                profile={profile}
                userId={userId}
                onSaveSuccess={invalidateProfile}
              />
            </div>
          ) : null
        ) : null}
      </div>
    </div>
  );
}
