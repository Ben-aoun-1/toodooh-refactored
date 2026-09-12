import { SearchX } from 'lucide-react';
import { Link } from 'react-router-dom';

import logoFull from '@/assets/logo.png';
import { useAuthStore } from '@/features/auth/stores/auth.store';
import { resolveHomeRoute } from '@/features/auth/utils/home-route';

/**
 * MINOR-1/29 — the « Page introuvable » screen behind App.tsx's catch-all route. Unknown URLs
 * used to <Navigate> to /login, which (for a signed-in visitor) bounced straight on to their
 * dashboard — a mistyped link was indistinguishable from a refresh. « Retour à l'accueil » goes
 * where a login would land (resolveHomeRoute) or to /login when nobody is signed in; the
 * protected routes keep their own guards, this page only replaces the silent redirect.
 */
export default function NotFoundPage() {
  const { user, profileType, role, validationStatus } = useAuthStore();
  const home = user ? resolveHomeRoute(profileType, role, validationStatus) : '/login';

  return (
    <div className="min-h-screen bg-white flex flex-col">
      <header className="border-b border-gray-100 bg-white">
        <div className="max-w-7xl mx-auto flex items-center px-4 py-3">
          <img src={logoFull} alt="Toodooh" className="h-10 w-auto object-contain flex-shrink-0" />
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center px-4 py-12">
        <div className="w-full max-w-xl text-center">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-brand-primary/10">
            <SearchX className="h-7 w-7 text-brand-primary" aria-hidden="true" />
          </div>
          <p className="text-sm font-semibold uppercase tracking-wide text-gray-400">Erreur 404</p>
          <h1 className="mt-2 text-2xl font-bold text-gray-900">Page introuvable</h1>
          <p className="mt-3 text-sm text-gray-500">
            La page que vous cherchez n&apos;existe pas ou a été déplacée. Vérifiez l&apos;adresse
            ou revenez à l&apos;accueil.
          </p>
          <Link
            to={home}
            replace
            className="mt-8 inline-flex items-center justify-center rounded-xl bg-brand-primary px-5 py-2.5 text-sm font-semibold text-brand-deep transition-colors hover:bg-brand-primary/90"
          >
            Retour à l&apos;accueil
          </Link>
        </div>
      </main>
    </div>
  );
}
