import { XCircle } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import AuthLayout from '@/features/auth/components/AuthLayout';
import { useAuthStore } from '@/features/auth/stores/auth.store';

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
  const validationNotes = useAuthStore((s) => s.validationNotes);
  const rejectionTopics = useAuthStore((s) => s.rejectionTopics);
  const [signingOut, setSigningOut] = useState(false);

  const handleSignOut = async () => {
    setSigningOut(true);
    await logout();
    navigate('/login');
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
          onClick={() => void handleSignOut()}
          disabled={signingOut}
          className="block w-full rounded-xl bg-brand-primary py-3.5 text-base font-semibold text-brand-deep transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {signingOut ? 'Déconnexion...' : 'Se déconnecter'}
        </button>
      </div>
    </AuthLayout>
  );
}
