import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';

import {
  useDeleteSimulation,
  useSimulation,
  useSimulationProbe,
  useWorld,
  useWorldVenues,
} from '@/features/admin/hooks/useAdminSimulator';

import { GenerateWorldForm } from './GenerateWorldForm';
import { SimulationStatusBadge } from './SimulationStatusBadge';
import { VenuesTable } from './VenuesTable';
import { WorldCard } from './WorldCard';

interface Props {
  id: string;
  onDeleted: () => void;
}

export function SimulationDetail({ id, onDeleted }: Props) {
  const sim = useSimulation(id);
  const ready = sim.data?.status === 'ready';
  const probe = useSimulationProbe(id, ready);
  const world = useWorld(id, ready);
  const hasWorld = Boolean(world.data);
  const venues = useWorldVenues(id, hasWorld);
  const del = useDeleteSimulation();
  const [confirming, setConfirming] = useState(false);

  if (sim.isLoading) return <Loader2 className="h-5 w-5 animate-spin text-gray-400" />;
  if (!sim.data) return <p className="text-sm text-red-600">Simulation introuvable.</p>;
  const s = sim.data;
  const busy = s.status === 'creating' || s.status === 'deleting';

  return (
    <section className="space-y-3 rounded-xl border bg-white p-4">
      <header className="flex items-center justify-between">
        <h2 className="text-base font-semibold">{s.name}</h2>
        <SimulationStatusBadge status={s.status} />
      </header>
      <dl className="grid grid-cols-2 gap-2 text-sm">
        <dt className="text-gray-500">Horloge virtuelle</dt>
        <dd>{format(new Date(s.virtual_now), 'EEEE dd MMMM yyyy HH:mm', { locale: fr })}</dd>
        <dt className="text-gray-500">Créée le</dt>
        <dd>{format(new Date(s.created_at), 'dd/MM/yyyy HH:mm', { locale: fr })}</dd>
        {s.error && (
          <>
            <dt className="text-gray-500">Erreur</dt>
            <dd className="text-red-600">{s.error}</dd>
          </>
        )}
      </dl>
      {s.status === 'creating' && (
        <p className="flex items-center gap-2 text-sm text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Base de données en cours de création…
        </p>
      )}
      {ready && probe.data && (
        <dl className="grid grid-cols-2 gap-2 rounded-lg bg-gray-50 p-3 text-center text-sm sm:grid-cols-4">
          <div>
            <dt className="text-gray-500">Screenhosts</dt>
            <dd className="text-lg font-semibold">{probe.data.screenhosts}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Campagnes</dt>
            <dd className="text-lg font-semibold">{probe.data.campaigns}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Utilisateurs</dt>
            <dd className="text-lg font-semibold">{probe.data.users}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Config dispatch</dt>
            <dd className="text-lg font-semibold">
              {probe.data.dispatch_config_present ? 'présente' : 'absente'}
            </dd>
          </div>
        </dl>
      )}
      {ready && probe.isError && (
        <p className="text-sm text-red-600">Impossible de lire la base de la simulation.</p>
      )}
      {ready && !hasWorld && !world.isLoading && <GenerateWorldForm simulationId={id} />}

      <div className="flex flex-wrap items-center gap-2">
        {!confirming ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => setConfirming(true)}
            className="rounded-lg border border-red-300 px-3 py-1.5 text-sm text-red-700 disabled:opacity-50"
          >
            Supprimer
          </button>
        ) : (
          <>
            <span className="text-sm text-gray-600">Supprimer la base de données ?</span>
            <button
              type="button"
              disabled={del.isPending}
              onClick={() => del.mutate(id, { onSuccess: onDeleted })}
              className="rounded-lg bg-red-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"
            >
              Oui, supprimer
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded-lg border px-3 py-1.5 text-sm"
            >
              Annuler
            </button>
          </>
        )}
        {del.isError && <span className="text-sm text-red-600">Suppression impossible.</span>}
      </div>

      {world.data && <WorldCard world={world.data} />}
      {venues.data && venues.data.venues.length > 0 && <VenuesTable venues={venues.data.venues} />}
    </section>
  );
}
