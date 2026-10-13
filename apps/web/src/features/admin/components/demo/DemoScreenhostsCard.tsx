import { MapPin, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'react-hot-toast';

import { CreateDemoScreenhostForm } from '@/features/admin/components/demo/CreateDemoScreenhostForm';
import { useDeleteDemoScreenhost } from '@/features/admin/hooks/useAdminDemo';
import type { DemoScreenhost, DemoSector } from '@/features/admin/services/admin-demo.service';
import { getErrorMessage } from '@/lib/errors';

const hours = (s: DemoScreenhost): string =>
  s.opening_hour === null || s.closing_hour === null
    ? '—'
    : `${s.opening_hour} h → ${s.closing_hour} h`;

/** DEMO-2 (ruled A A) — the admin-made demo screenhosts: seen and bought by demo accounts only. */
export function DemoScreenhostsCard({
  screenhosts,
  sectors,
}: {
  screenhosts: DemoScreenhost[];
  sectors: DemoSector[];
}) {
  const remove = useDeleteDemoScreenhost();
  const [confirming, setConfirming] = useState<string | null>(null);

  const destroy = async (id: string) => {
    try {
      await remove.mutateAsync(id);
      toast.success('Screenhost démo retiré');
      setConfirming(null);
    } catch (e) {
      toast.error(getErrorMessage(e) || 'Suppression impossible');
    }
  };

  return (
    <section className="rounded-xl border bg-white p-5">
      <div className="flex items-center gap-2">
        <MapPin className="h-5 w-5 text-brand-primary" />
        <h2 className="text-base font-semibold">Screenhosts démo</h2>
        <span className="ml-auto text-sm text-gray-500">{screenhosts.length}</span>
      </div>
      <p className="mt-1 text-sm text-gray-500">
        Des points fictifs sur la carte, avec une audience aléatoire. Seuls les comptes démo les
        voient et peuvent y diffuser ; aucun écran, aucun propriétaire, aucun revenu.
      </p>
      <div className="mt-4">
        <CreateDemoScreenhostForm sectors={sectors} />
      </div>
      {screenhosts.length === 0 ? (
        <p className="mt-4 text-sm text-gray-500">Aucun screenhost démo pour le moment.</p>
      ) : (
        <ul className="mt-4 divide-y rounded-lg border">
          {screenhosts.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
              <span className="font-medium">{s.name}</span>
              <span className="text-gray-500">
                {[s.city, s.sector_name, hours(s)].filter(Boolean).join(' · ')}
              </span>
              <div className="ml-auto flex items-center gap-2">
                {confirming === s.id ? (
                  <>
                    <span className="text-red-700">Retirer de la carte ?</span>
                    <button
                      type="button"
                      onClick={() => void destroy(s.id)}
                      disabled={remove.isPending}
                      className="rounded-lg bg-red-600 px-3 py-1.5 font-medium text-white disabled:opacity-60"
                    >
                      Confirmer
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirming(null)}
                      className="rounded-lg border px-3 py-1.5"
                    >
                      Annuler
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirming(s.id)}
                    className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-red-700 hover:bg-red-50"
                  >
                    <Trash2 className="h-4 w-4" />
                    Retirer
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
