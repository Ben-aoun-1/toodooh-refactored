import { Megaphone } from 'lucide-react';
import { useState } from 'react';

import { CampaignEligibleHosts } from '@/features/admin/components/CampaignEligibleHosts';
import { SimulationCampaignInspector } from '@/features/admin/components/simulator/SimulationCampaignInspector';
import { SimulationLaunchForm } from '@/features/admin/components/simulator/SimulationLaunchForm';
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
  const [eligibleFor, setEligibleFor] = useState<{ id: string; name: string } | null>(null);
  const [inspectId, setInspectId] = useState<string | null>(null);

  return (
    <section className="space-y-3 rounded-xl border bg-white p-4">
      <header className="flex items-center gap-2">
        <Megaphone className="h-5 w-5 text-brand-primary" />
        <h2 className="text-sm font-semibold text-gray-700">Campagnes</h2>
      </header>

      <SimulationLaunchForm simulationId={simulationId} />

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
                    <button
                      type="button"
                      onClick={() => setInspectId(c.id)}
                      className="ml-2 whitespace-nowrap text-xs text-brand-deep underline"
                    >
                      Inspecter
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {inspectId && (
        <SimulationCampaignInspector
          key={inspectId}
          simulationId={simulationId}
          campaignId={inspectId}
          onClose={() => setInspectId(null)}
        />
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
