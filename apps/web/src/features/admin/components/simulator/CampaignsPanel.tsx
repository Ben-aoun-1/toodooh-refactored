import { CalendarClock, Megaphone, Plus } from 'lucide-react';
import { useState } from 'react';

import { CampaignEligibleHosts } from '@/features/admin/components/CampaignEligibleHosts';
import { useLaunchCampaign, useLaunchEvent } from '@/features/admin/hooks/useAdminSimulator';
import type { BoardCampaign } from '@/features/admin/services/admin-simulator.service';

const STATUS_CLASS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700',
  pending: 'bg-amber-100 text-amber-800',
  upcoming: 'bg-sky-100 text-sky-800',
  active: 'bg-emerald-100 text-emerald-800',
  completed: 'bg-violet-100 text-violet-800',
  rejected: 'bg-red-100 text-red-800',
};

export function CampaignsPanel({
  simulationId,
  campaigns,
}: {
  simulationId: string;
  campaigns: BoardCampaign[];
}) {
  const launch = useLaunchCampaign(simulationId);
  const bookEvent = useLaunchEvent(simulationId);
  const [days, setDays] = useState(7);
  const [spot, setSpot] = useState(10);
  const [share, setShare] = useState(40);
  const [eligibleFor, setEligibleFor] = useState<{ id: string; name: string } | null>(null);

  return (
    <section className="space-y-3 rounded-xl border bg-white p-4">
      <header className="flex items-center gap-2">
        <Megaphone className="h-5 w-5 text-brand-primary" />
        <h2 className="text-sm font-semibold text-gray-700">Campagnes</h2>
      </header>

      <div className="flex flex-wrap items-end gap-3 rounded-lg bg-gray-50 p-3">
        <label className="text-sm">
          <span className="block text-xs text-gray-600">Durée (jours)</span>
          <input
            type="number"
            min={1}
            max={90}
            className="mt-1 w-24 rounded-lg border px-2 py-1"
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
          />
        </label>
        <label className="text-sm">
          <span className="block text-xs text-gray-600">Spot (s)</span>
          <input
            type="number"
            min={5}
            max={30}
            className="mt-1 w-20 rounded-lg border px-2 py-1"
            value={spot}
            onChange={(e) => setSpot(Number(e.target.value))}
          />
        </label>
        <label className="text-sm">
          <span className="block text-xs text-gray-600">Budget (% du C_max)</span>
          <input
            type="number"
            min={1}
            max={100}
            className="mt-1 w-24 rounded-lg border px-2 py-1"
            value={share}
            onChange={(e) => setShare(Number(e.target.value))}
          />
        </label>
        <button
          type="button"
          disabled={launch.isPending}
          onClick={() =>
            launch.mutate({ duration_days: days, spot_seconds: spot, budget_share: share / 100 })
          }
          className="flex items-center gap-1 rounded-lg bg-brand-primary px-3 py-2 text-sm font-medium text-brand-deep disabled:opacity-50"
        >
          <Plus className="h-4 w-4" />
          {launch.isPending ? 'Lancement…' : 'Lancer une campagne'}
        </button>
        <button
          type="button"
          disabled={bookEvent.isPending}
          onClick={() => bookEvent.mutate({ spot_seconds: spot, budget_share: share / 100 })}
          className="flex items-center gap-1 rounded-lg border border-brand-deep px-3 py-2 text-sm font-medium text-brand-deep disabled:opacity-50"
        >
          <CalendarClock className="h-4 w-4" />
          {bookEvent.isPending ? 'Réservation…' : 'Réserver un match'}
        </button>
      </div>

      {launch.isError && (
        <p className="text-sm text-red-600">
          {launch.error instanceof Error ? launch.error.message : 'Lancement impossible.'}
        </p>
      )}
      {bookEvent.isError && (
        <p className="text-sm text-red-600">
          {bookEvent.error instanceof Error ? bookEvent.error.message : 'Réservation impossible.'}
        </p>
      )}
      {bookEvent.data && (
        <p className="text-sm text-gray-600">
          « {bookEvent.data.name} » — {bookEvent.data.allocations} établissements réservés, budget{' '}
          {bookEvent.data.budget_tnd} TND sur un plafond événement de {bookEvent.data.c_max_tnd}{' '}
          TND.
        </p>
      )}
      {launch.data && (
        <p className="text-sm text-gray-600">
          « {launch.data.name} » — {launch.data.allocations} établissements retenus, budget{' '}
          {launch.data.budget_tnd} TND sur un plafond de {launch.data.c_max_tnd} TND.
        </p>
      )}

      {campaigns.length === 0 ? (
        <p className="text-sm text-gray-500">Aucune campagne pour l&apos;instant.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b text-xs uppercase tracking-wide text-gray-600">
              <tr>
                <th className="px-2 py-2 text-left font-medium">Campagne</th>
                <th className="px-2 py-2 text-left font-medium">Statut</th>
                <th className="px-2 py-2 text-left font-medium">Fenêtre</th>
                <th className="px-2 py-2 text-left font-medium">Budget</th>
                <th className="px-2 py-2 text-left font-medium">Réponses</th>
                <th className="px-2 py-2 text-left font-medium">Diffusions</th>
                <th className="px-2 py-2 text-left font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {campaigns.map((c) => (
                <tr key={c.id}>
                  <td className="px-2 py-2 font-medium">{c.name}</td>
                  <td className="px-2 py-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ${STATUS_CLASS[c.status] ?? 'bg-gray-100'}`}
                    >
                      {c.status}
                    </span>
                  </td>
                  <td className="px-2 py-2 text-gray-600">
                    {c.start_date ?? '—'} → {c.end_date ?? '—'}
                  </td>
                  <td className="px-2 py-2">
                    {c.budget_tnd === null ? '—' : `${c.budget_tnd} TND`}
                  </td>
                  <td className="px-2 py-2">
                    <span className="text-emerald-600">{c.accepted}</span> ·{' '}
                    <span className="text-red-600">{c.refused}</span> ·{' '}
                    <span className="text-amber-600">{c.pending}</span>
                  </td>
                  <td className="px-2 py-2 font-semibold">{c.proofs}</td>
                  <td className="px-2 py-2">
                    <button
                      type="button"
                      onClick={() => setEligibleFor({ id: c.id, name: c.name })}
                      className="whitespace-nowrap text-xs text-brand-deep underline"
                    >
                      Hosts éligibles
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {eligibleFor && (
        <CampaignEligibleHosts
          key={eligibleFor.id}
          campaignId={eligibleFor.id}
          simulationId={simulationId}
          title={`Hosts éligibles — ${eligibleFor.name}`}
          defaultOpen
        />
      )}
    </section>
  );
}
