import { ChevronDown, ChevronRight, Loader2, MapPin } from 'lucide-react';
import { useState } from 'react';

import { useCampaignEligibleHosts } from '@/features/admin/hooks/useAdminCampaigns';
import { useSimulationCampaignEligibleHosts } from '@/features/admin/hooks/useAdminSimulator';
import {
  ALLOCATION_STATUT_LABEL,
  columnLabels,
  exclusionLabel,
  exclusionSummary,
} from '@/features/admin/lib/eligible-hosts';
import { ApiError } from '@/lib/api-client';

// ELIG-1 — « Hosts éligibles » inside the campaign examen, at any status. Collapsed by default:
// the report runs the real pool assembly, so it is fetched only when the admin opens it. With a
// `simulationId` the same panel reads a sandbox campaign (SIM-5) — same api code, other database.

const nf = (n: number): string => n.toLocaleString('fr-FR');

export function CampaignEligibleHosts({
  campaignId,
  simulationId = null,
  title = 'Hosts éligibles',
  defaultOpen = false,
}: {
  campaignId: string;
  simulationId?: string | null;
  title?: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [showExcluded, setShowExcluded] = useState(false);
  const real = useCampaignEligibleHosts(campaignId, open && simulationId === null);
  const sandbox = useSimulationCampaignEligibleHosts(simulationId, campaignId, open);
  const query = simulationId === null ? real : sandbox;
  const report = query.data;
  const noDates = query.error instanceof ApiError && query.error.code === 'NO_DATES';
  const cols = report ? columnLabels(report.kind) : null;

  return (
    <div className="rounded-lg border border-gray-200 p-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 text-left text-sm font-medium text-gray-700"
      >
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        <MapPin className="h-4 w-4 text-brand-primary" />
        {title}
        {report && (
          <span className="ml-auto text-xs font-normal text-gray-500">
            {report.totals.eligible} éligibles · {report.totals.excluded} exclus
          </span>
        )}
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          {query.isLoading && <Loader2 className="h-4 w-4 animate-spin text-gray-400" />}
          {noDates && (
            <p className="text-sm text-gray-600">
              La campagne n&apos;a pas encore de période : les établissements éligibles dépendent
              des dates.
            </p>
          )}
          {query.isError && !noDates && (
            <p className="text-sm text-red-600">Impossible de calculer les hosts éligibles.</p>
          )}

          {report && cols && (
            <>
              <p className="text-xs text-gray-500">
                Calcul à l&apos;instant, par le moteur de{' '}
                {report.kind === 'event' ? 'tarification événement' : 'dispatch'} · spot{' '}
                {report.spot_seconds} s
                {report.spot_source === 'default' ? ' (par défaut, aucune vidéo liée)' : ''} · CPM{' '}
                {report.cpm_tnd} TND · plafond {nf(report.totals.c_max_tnd)} TND pour{' '}
                {nf(report.totals.capacity)} impressions.
              </p>

              {report.eligible.length === 0 ? (
                <p className="text-sm text-gray-600">Aucun établissement éligible.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b text-gray-500">
                      <tr>
                        <th className="py-1 pr-2 font-medium">Établissement</th>
                        <th className="py-1 pr-2 font-medium">Catégorie</th>
                        <th className="py-1 pr-2 font-medium">Gamme</th>
                        <th className="py-1 pr-2 font-medium">SPS</th>
                        <th className="py-1 pr-2 font-medium">{cols.affluence}</th>
                        <th className="py-1 pr-2 font-medium">{cols.hours}</th>
                        <th className="py-1 pr-2 font-medium">{cols.capacity}</th>
                        <th className="py-1 font-medium">Proposition</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {report.eligible.map((v) => (
                        <tr key={v.id}>
                          <td className="py-1 pr-2 font-medium text-gray-900">{v.name}</td>
                          <td className="py-1 pr-2">{v.sector ?? '—'}</td>
                          <td className="py-1 pr-2">{v.class ?? '—'}</td>
                          <td className="py-1 pr-2">{Math.round(v.sps)}</td>
                          <td className="py-1 pr-2">{nf(v.affluence)}</td>
                          <td className="py-1 pr-2">
                            {nf(v.hours)}
                            {v.days_available !== null && (
                              <span className="text-gray-400"> · {v.days_available} j</span>
                            )}
                          </td>
                          <td className="py-1 pr-2">{nf(v.capacity)}</td>
                          <td className="py-1">
                            {v.allocation
                              ? `${ALLOCATION_STATUT_LABEL[v.allocation.statut] ?? v.allocation.statut} (${nf(v.allocation.impressions)})`
                              : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {report.excluded.length > 0 && (
                <div>
                  <button
                    type="button"
                    onClick={() => setShowExcluded((v) => !v)}
                    className="text-xs text-gray-600 underline"
                  >
                    {showExcluded ? 'Masquer' : 'Voir'} les {report.excluded.length} établissements
                    exclus
                  </button>
                  <p className="mt-1 text-xs text-gray-500">
                    {exclusionSummary(report.excluded)
                      .map((s) => `${s.label} : ${s.count}`)
                      .join(' · ')}
                  </p>
                  {showExcluded && (
                    <ul className="mt-2 max-h-48 divide-y overflow-y-auto text-xs">
                      {report.excluded.map((e) => (
                        <li key={e.id} className="flex justify-between gap-2 py-1">
                          <span className="text-gray-900">{e.name}</span>
                          <span className="text-gray-500">{exclusionLabel(e.reason)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
