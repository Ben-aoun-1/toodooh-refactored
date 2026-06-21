import { CheckCircle2, XCircle } from 'lucide-react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';

import AuthLayout from '@/features/auth/components/AuthLayout';
import { useAuthStore } from '@/features/auth/stores/auth.store';
import { resolveHomeRoute } from '@/features/auth/utils/home-route';

// Phase-1f F3 + slice-1 auth-bug-2 — the verify-email redirect target. better-auth verifies the JWT
// server-side at /auth/verify-email, then redirects here (`?error=` on failure, no param on success).
// This page makes NO API call — it reads the result and the session.
//
// With auto-login-on-verify (auth.ts `autoSignInAfterVerification`), a FIRST verify sets the session
// cookie on the redirect response, so by the time this renders the store is rehydrated (App gates
// render on `initialized`) and `user` is truthy → we land the user in their dashboard via the same
// resolver login uses. The already-verified re-click (G1 one-shot) carries no session → we fall back
// to a success page with a "Se connecter" CTA (not a dead-end, not an error).
export default function VerifyEmail() {
  const [params] = useSearchParams();
  const isError = params.get('error') !== null;
  const { user, profileType, role, validationStatus } = useAuthStore();

  // Auto-login succeeded (unverified→verified transition minted a session) → straight to the dashboard
  // (or the status screen if the account was rejected — resolveHomeRoute decides).
  if (!isError && user) {
    return <Navigate to={resolveHomeRoute(profileType, role, validationStatus)} replace />;
  }

  return (
    <AuthLayout
      title={isError ? 'Lien invalide' : 'Email vérifié'}
      subtitle={
        isError
          ? 'Ce lien de vérification est invalide ou a expiré.'
          : 'Votre adresse email est confirmée.'
      }
    >
      <div className="space-y-5 text-center">
        {isError ? (
          <XCircle className="mx-auto h-14 w-14 text-red-500" />
        ) : (
          <CheckCircle2 className="mx-auto h-14 w-14 text-brand-primary" />
        )}
        <p className="text-sm text-gray-600">
          {isError
            ? 'Connectez-vous pour recevoir un nouveau lien de vérification.'
            : 'Connectez-vous pour accéder à votre espace.'}
        </p>
        <Link
          to="/login"
          className="block w-full py-3.5 rounded-xl font-semibold text-base text-brand-deep text-center bg-brand-primary hover:opacity-90 transition-opacity"
        >
          {isError ? 'Aller à la connexion' : 'Se connecter'}
        </Link>
      </div>
    </AuthLayout>
  );
}
