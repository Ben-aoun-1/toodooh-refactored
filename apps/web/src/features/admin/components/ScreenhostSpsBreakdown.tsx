import { useQuery } from '@tanstack/react-query';
import { ChevronDown, Gauge } from 'lucide-react';
import { useState } from 'react';

import { adminKeys } from '@/features/admin/hooks/queryKeys';
import {
  type SpsVariableView,
  adminScreenhostService,
} from '@/features/admin/services/admin-screenhost.service';

/** The ruled French labels — ONE home, pinned by tests. */
export const SPS_VARIABLE_LABELS: Record<string, string> = {
  acceptation: "Taux d'acceptation des campagnes",
  respect_evenements: 'Respect des événements acceptés',
  activite: "Activité de l'écran",
  remplissage: 'Taux de remplissage',
};

const fr = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });

interface ScreenhostSpsBreakdownProps {
  screenhostId: string;
}

/**
 * E4 — the admin SPS insight, beside the eligibility badge: a « Score SPS » toggle unfolding the
 * four ruled variables (value × weight) and the live weighted total. Read-only by construction —
 * the score is COMPUTED (daily job + on-decision), never set.
 */
export default function ScreenhostSpsBreakdown({ screenhostId }: ScreenhostSpsBreakdownProps) {
  const [open, setOpen] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: adminKeys.screenhostSps(screenhostId),
    queryFn: () => adminScreenhostService.getSps(screenhostId),
    enabled: open,
  });

  const rows: [string, SpsVariableView][] = data
    ? [
        ['acceptation', data.variables.acceptation],
        ['respect_evenements', data.variables.respect_evenements],
        ['activite', data.variables.activite],
        ['remplissage', data.variables.remplissage],
      ]
    : [];

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-3 py-2 text-sm text-gray-700"
      >
        <span className="flex items-center gap-1.5 font-medium">
          <Gauge className="h-4 w-4 text-brand-deep" />
          Score SPS
        </span>
        <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="border-t border-gray-200 px-3 py-2.5 space-y-1.5">
          {isLoading || !data ? (
            <p className="text-xs text-gray-500">Calcul du score…</p>
          ) : (
            <>
              {rows.map(([key, v]) => (
                <div key={key} className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-gray-600">
                    {SPS_VARIABLE_LABELS[key]}
                    <span className="text-gray-400"> · {fr.format(v.weight)} %</span>
                  </span>
                  <span className="font-medium text-gray-900">{fr.format(v.value)}</span>
                </div>
              ))}
              <div className="flex items-center justify-between gap-2 border-t border-gray-200 pt-1.5 text-sm">
                <span className="font-medium text-gray-700">Score pondéré</span>
                <span className="font-semibold text-brand-deep">{fr.format(data.sps)} / 100</span>
              </div>
              {data.stored_sps !== data.sps && (
                <p className="text-[11px] text-gray-400">
                  Valeur enregistrée : {fr.format(data.stored_sps)} (prochaine mise à jour au
                  passage quotidien)
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
