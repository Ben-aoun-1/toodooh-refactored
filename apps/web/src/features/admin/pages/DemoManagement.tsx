import { Loader2, Presentation, Users } from 'lucide-react';
import { useEffect, useState } from 'react';

import AdminLayout from '@/features/admin/components/AdminLayout';
import { CreateDemoAccountForm } from '@/features/admin/components/demo/CreateDemoAccountForm';
import { DemoAccountRow } from '@/features/admin/components/demo/DemoAccountRow';
import { DemoDelayCard } from '@/features/admin/components/demo/DemoDelayCard';
import { DemoScreenhostsCard } from '@/features/admin/components/demo/DemoScreenhostsCard';
import { DemoVenuesCard } from '@/features/admin/components/demo/DemoVenuesCard';
import { useDemoPage } from '@/features/admin/hooks/useAdminDemo';

// DEMO-1 (operator 2026-10-12, rulings A A A A A A) — « Démo »: demo screencaster accounts with a
// pre-filled balance, whose campaigns air on REAL venues (the ones ticked here) the set number of
// minutes after their cart is confirmed — no admin review, no owner acceptance, no owner revenue.
// DEMO-2 (2026-10-13) — plus demo screenhosts: admin-made map points with a random audience.

export default function DemoManagement() {
  const page = useDemoPage();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(timer);
  }, []);

  return (
    <AdminLayout title="Démo">
      <div className="mx-auto max-w-5xl space-y-4 p-4">
        <header className="flex items-center gap-3">
          <Presentation className="h-6 w-6 text-brand-primary" />
          <div>
            <h1 className="text-xl font-semibold">Mode démo</h1>
            <p className="text-sm text-gray-500">
              Comptes screencaster de démonstration : leurs campagnes passent sans validation et
              sont diffusées sur les écrans réels sélectionnés, sans revenu pour le propriétaire.
            </p>
          </div>
        </header>

        {page.isLoading && (
          <div className="flex justify-center p-10">
            <Loader2 className="h-6 w-6 animate-spin text-brand-primary" />
          </div>
        )}
        {page.isError && (
          <p className="rounded-xl border bg-white p-5 text-sm text-red-700">
            Impossible de charger la page démo.
          </p>
        )}
        {page.data && (
          <>
            <DemoDelayCard delayMinutes={page.data.delay_minutes} />
            <DemoVenuesCard venues={page.data.venues} />
            <DemoScreenhostsCard
              screenhosts={page.data.demo_screenhosts}
              sectors={page.data.sectors}
            />
            <section className="rounded-xl border bg-white p-5">
              <div className="flex items-center gap-2">
                <Users className="h-5 w-5 text-brand-primary" />
                <h2 className="text-base font-semibold">Comptes démo</h2>
              </div>
              <p className="mt-1 text-sm text-gray-500">
                Le compte est créé validé, avec un profil pré-rempli et le solde indiqué. Partagez
                l’e-mail et le mot de passe avec le prospect.
              </p>
              <div className="mt-4">
                <CreateDemoAccountForm />
              </div>
              {page.data.accounts.length === 0 ? (
                <p className="mt-4 text-sm text-gray-500">Aucun compte démo pour le moment.</p>
              ) : (
                <ul className="mt-4 divide-y rounded-lg border">
                  {page.data.accounts.map((a) => (
                    <DemoAccountRow key={a.id} account={a} now={now} />
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
    </AdminLayout>
  );
}
