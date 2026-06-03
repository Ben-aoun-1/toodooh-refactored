import { Mail, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'react-hot-toast';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';

import logoFull from '@/assets/logo.png';
import { authService } from '@/features/auth/services/auth.service';
import { getErrorMessage } from '@/lib/errors';

// Slice-1 auth-bug-1 — the post-signup "Inscription – Validation" screen (Figma, role-agnostic copy).
// Replaces the old toast + 2s redirect-to-/login: signup success now lands here so the user gets the
// "check your email" guidance + a real resend affordance. The email is passed via router state from
// SignUpForm; a direct visit / refresh has no email, so the screen is meaningless → bounce to /login.
export default function SignUpSuccess() {
  const navigate = useNavigate();
  const location = useLocation();
  const email = (location.state as { email?: string } | null)?.email;
  const [resending, setResending] = useState(false);

  if (!email) {
    return <Navigate to="/login" replace />;
  }

  const handleResend = async () => {
    setResending(true);
    try {
      await authService.resendVerificationEmail(email);
      toast.success('E-mail de vérification renvoyé. Pensez à vérifier vos spams.');
    } catch (error) {
      toast.error(getErrorMessage(error) || "Impossible d'envoyer l'e-mail pour le moment.");
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* Header bar — same chrome as the signup wizard, minus the stepper */}
      <header className="border-b border-gray-100 bg-white sticky top-0 z-30">
        <div className="max-w-7xl mx-auto flex items-center justify-between px-4 py-3">
          <img src={logoFull} alt="Toodooh" className="h-10 w-auto object-contain flex-shrink-0" />
          <div className="flex items-center gap-2 text-sm text-gray-500 flex-shrink-0">
            <span className="hidden sm:inline">Déjà confirmé ?</span>
            <button
              type="button"
              onClick={() => navigate('/login')}
              className="px-4 py-1.5 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors text-sm font-medium"
            >
              Se connecter
            </button>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 flex flex-col items-center justify-center px-4 py-12">
        <div className="w-full max-w-xl text-center">
          {/* Envelope icon */}
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-brand-primary/10">
            <Mail className="h-7 w-7 text-brand-primary" />
          </div>

          <h1 className="text-2xl font-bold text-gray-900">Merci pour votre inscription !</h1>
          <p className="mt-3 text-sm text-gray-500">
            Pour finaliser la création de votre compte Toodooh, nous venons de vous envoyer un email
            de confirmation.
          </p>

          {/* Info box */}
          <div className="mt-6 flex items-start gap-3 rounded-xl border border-gray-200 bg-gray-50 p-4 text-left">
            <Mail className="mt-0.5 h-5 w-5 flex-shrink-0 text-brand-primary" />
            <p className="text-sm text-gray-600">
              Veuillez cliquer sur le lien de validation dans votre boîte de réception (ou vos
              spams). Une fois votre email confirmé, vous pourrez accéder à votre tableau de bord et
              accepter votre première campagne !
            </p>
          </div>

          {/* Resend button */}
          <button
            type="button"
            onClick={handleResend}
            disabled={resending}
            className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-brand-primary py-3.5 text-base font-semibold text-brand-deep transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw className={`h-5 w-5 ${resending ? 'animate-spin' : ''}`} />
            {resending ? 'Envoi en cours...' : "Renvoyer l'e-mail de vérification"}
          </button>
        </div>
      </main>
    </div>
  );
}
