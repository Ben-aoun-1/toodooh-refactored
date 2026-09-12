import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Send } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'react-hot-toast';
import { Link, useNavigate } from 'react-router-dom';

import { authKeys } from '@/features/auth/hooks/queryKeys';
import { useBusinessProfile } from '@/features/auth/hooks/useBusinessProfile';
import { authService } from '@/features/auth/services/auth.service';
import { useAuthStore } from '@/features/auth/stores/auth.store';
import { resolveHomeRoute } from '@/features/auth/utils/home-route';
import OwnerBankDetailsSlot from '@/features/profile/components/OwnerBankDetailsSlot';
import ProfileDocumentsManager, {
  type DocumentCategoryConfig,
} from '@/features/profile/components/ProfileDocumentsManager';
import { getErrorMessage } from '@/lib/errors';

// N3 Scenario 1 — the document-correction surface for a REJECTED account, reachable under the
// RejectedRoute gate (the normal /profile & /owner-settings surfaces bounce rejected users, C2). It
// REUSES the existing managers + endpoints (no new upload path): ProfileDocumentsManager (legal +
// complementaire) for everyone, and OwnerBankDetailsSlot (RIB, PATCH /api/profile/bank) for owners.
// After fixing, the user resubmits for review right here (the same POST /api/profile/resubmit that
// AccountRejected.tsx uses) — no manual hop back to the status screen. The "Retour" link stays as a
// secondary path back to /account-rejected.
export default function CorrectDocuments() {
  const navigate = useNavigate();
  const userId = useAuthStore((s) => s.user?.id ?? '');
  const profileType = useAuthStore((s) => s.profileType);
  const refreshUserStatus = useAuthStore((s) => s.refreshUserStatus);
  const queryClient = useQueryClient();
  const { profile, loading } = useBusinessProfile(userId);
  const [resubmitting, setResubmitting] = useState(false);

  const isOwner = profileType === 'individual_owner' || profileType === 'fleet_owner';
  // Same categories /profile (advertiser) and /owner-settings (owner) pass. CIN-2 (2026-09-12):
  // the CIN is removed. CIN-2b: every profile files an RNE (individual owners included) plus the
  // optional "complémentaires".
  const docCategories: DocumentCategoryConfig[] = [
    { category: 'rne', title: 'Registre de commerce (RNE)' },
    { category: 'complementaire', title: 'Documents complémentaires' },
  ];

  // Uploads/bank-saves flip /api/me's document booleans + bank fields; refresh the profile query so
  // the bank slot re-prefills and the user stays on this page (no dashboard bounce).
  const invalidateProfile = () =>
    void queryClient.invalidateQueries({ queryKey: authKeys.profile(userId) });

  // Resubmit for review: mirrors AccountRejected.tsx exactly — the server returns the account to
  // 'pending', we re-read /api/me so the store reflects pending, then land on the normal dashboard
  // (resolveHomeRoute routes pending there).
  const handleResubmit = async () => {
    setResubmitting(true);
    try {
      await authService.resubmitForReview();
      await refreshUserStatus();
      // Read the refreshed status straight from the store — the selectors above are stale until the
      // component re-renders, but resolveHomeRoute needs the now-'pending' status.
      const next = useAuthStore.getState();
      toast.success('Dossier renvoyé pour révision');
      navigate(resolveHomeRoute(next.profileType, next.role, next.validationStatus));
    } catch (error) {
      toast.error(getErrorMessage(error) || 'Erreur lors du renvoi');
      setResubmitting(false);
    }
  };

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
          Corrigez les documents signalés, puis renvoyez votre dossier en révision.
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

        <div className="mt-8 flex justify-end">
          <button
            type="button"
            onClick={() => void handleResubmit()}
            disabled={resubmitting}
            className="flex items-center justify-center gap-2 rounded-xl bg-brand-primary px-6 py-3 text-base font-semibold text-brand-deep transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Send className="h-5 w-5" />
            {resubmitting ? 'Envoi...' : 'Renvoyer pour révision'}
          </button>
        </div>
      </div>
    </div>
  );
}
