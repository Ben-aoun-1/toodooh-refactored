import { CheckCircle2, XCircle } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';

import AuthLayout from '@/features/auth/components/AuthLayout';

// Phase-1f F3 — the verify-email redirect target. better-auth verifies the JWT server-side at
// /auth/verify-email, then redirects here with `?error=` on failure (no param on success). This page
// makes NO API call — it reads the result and shows it. On error, the B′ recovery loop: sign in →
// an unverified account triggers a fresh verification email (auth.ts `sendOnSignIn`).
export default function VerifyEmail() {
  const [params] = useSearchParams();
  const isError = params.get('error') !== null;

  return (
    <AuthLayout
      title={isError ? 'Lien invalide' : 'Email vérifié'}
      subtitle={
        isError
          ? 'Ce lien de vérification est invalide ou a expiré.'
          : 'Votre adresse email a été confirmée.'
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
            : 'Vous pouvez maintenant vous connecter à votre compte.'}
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
