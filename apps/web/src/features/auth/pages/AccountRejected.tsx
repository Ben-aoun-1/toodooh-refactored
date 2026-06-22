import { FileEdit, Send, XCircle } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';

import AuthLayout from '@/features/auth/components/AuthLayout';
import { authService } from '@/features/auth/services/auth.service';
import { useAuthStore } from '@/features/auth/stores/auth.store';
import { resolveHomeRoute } from '@/features/auth/utils/home-route';
import { getErrorMessage } from '@/lib/errors';

// N3 Scenario 1 — French labels for the deficient document areas the admin flagged (mirrors the
// rejection email's REJECTION_TOPIC_LABELS_FR on the API side).
const TOPIC_LABELS_FR: Record<string, string> = {
  legal: 'Documents légaux (RNE / CIN)',
  bank: 'Coordonnées bancaires (RIB)',
};

// N3 — the account-status screen for a REJECTED end-user. Rejection gates the app (the routing in
// App.tsx / resolveHomeRoute sends a rejected account here), NOT authentication: the user stays
// signed in so they can read the admin's reason and, in a later commit (C3), fix + resubmit. For now
// the only action is sign-out. The reason comes from the auth store (validationNotes ← validation_notes
// on /api/signin & /api/me).
export default function AccountRejected() {
  const navigate = useNavigate();
  const logout = useAuthStore((s) => s.logout);
  const refreshUserStatus = useAuthStore((s) => s.refreshUserStatus);
  const validationNotes = useAuthStore((s) => s.validationNotes);
  const rejectionTopics = useAuthStore((s) => s.rejectionTopics);
  const [signingOut, setSigningOut] = useState(false);
  const [resubmitting, setResubmitting] = useState(false);

  const handleSignOut = async () => {
    setSigningOut(true);
    await logout();
    navigate('/login');
  };

  // Resubmit for review: the server returns the account to 'pending'; we re-read /api/me so the store
  // reflects pending, then land on the normal dashboard (resolveHomeRoute routes pending there).
  const handleResubmit = async () => {
    setResubmitting(true);
    try {
      await authService.resubmitForReview();
      await refreshUserStatus();
      const { profileType, role, validationStatus } = useAuthStore.getState();
      toast.success('Dossier renvoyé pour révision');
      navigate(resolveHomeRoute(profileType, role, validationStatus));
    } catch (error) {
      toast.error(getErrorMessage(error) || 'Erreur lors du renvoi');
      setResubmitting(false);
    }
  };

  return (
    <AuthLayout
      title="Inscription rejetée"
      subtitle="Votre inscription n'a pas été validée par notre équipe."
    >
      <div className="space-y-5 text-center">
        <XCircle className="mx-auto h-14 w-14 text-red-500" />
        <p className="text-sm text-gray-600">
          Votre inscription a été rejetée. Vous ne pouvez pas accéder à votre espace pour le moment.
        </p>
        {validationNotes ? (
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-left">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
              Motif du rejet
            </p>
            <p className="text-sm text-gray-700">{validationNotes}</p>
          </div>
        ) : null}
        {rejectionTopics && rejectionTopics.length > 0 ? (
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-left">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
              Documents à corriger
            </p>
            <ul className="list-inside list-disc text-sm text-gray-700">
              {rejectionTopics.map((topic) => (
                <li key={topic}>{TOPIC_LABELS_FR[topic] ?? topic}</li>
              ))}
            </ul>
          </div>
        ) : null}
        <button
          type="button"
          onClick={() => navigate('/account-rejected/documents')}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-primary py-3.5 text-base font-semibold text-brand-deep transition-opacity hover:opacity-90"
        >
          <FileEdit className="h-5 w-5" />
          Corriger mes documents
        </button>
        <button
          type="button"
          onClick={() => void handleResubmit()}
          disabled={resubmitting}
          className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-brand-primary bg-white py-3 text-base font-semibold text-brand-primary transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Send className="h-5 w-5" />
          {resubmitting ? 'Envoi...' : 'Renvoyer pour révision'}
        </button>
        <button
          type="button"
          onClick={() => void handleSignOut()}
          disabled={signingOut}
          className="text-sm text-gray-500 underline underline-offset-2 transition-colors hover:text-gray-700 disabled:opacity-50"
        >
          {signingOut ? 'Déconnexion...' : 'Se déconnecter'}
        </button>
      </div>
    </AuthLayout>
  );
}
