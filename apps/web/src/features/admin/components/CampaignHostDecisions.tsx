import { ChevronDown, ChevronRight, Loader2, UserCheck } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'react-hot-toast';

import { useDecideForHost, useHostDecisions } from '@/features/admin/hooks/useHostDecisions';
import {
  HOST_DECISION_LABEL,
  canAnswerForHost,
  hostDecisionSummary,
  refuseForHostQuestion,
  sortHostDecisions,
} from '@/features/admin/lib/host-decisions';
import type { HostDecisionRow } from '@/features/admin/services/admin-host-decisions.service';
import { getErrorMessage } from '@/lib/errors';

// Mariem 13/11/2026 (point 1) — « Réponses des Hosts » in the campaign examen: every Host the
// campaign was proposed to, its answer, and « Accepter » / « Refuser » for the Host while it is
// still awaited. The api runs the Host's own decision (a refusal is definitive and re-places the
// share) and tells the Host in-app that the Toodooh team answered.

const TND = (n: number): string =>
  `${n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DT`;

const PILL: Record<HostDecisionRow['statut'], string> = {
  EN_ATTENTE: 'bg-amber-50 text-amber-700',
  ACCEPTE: 'bg-green-50 text-green-700',
  REFUSE: 'bg-red-50 text-red-700',
  RESERVE: 'bg-gray-100 text-gray-600',
};

export function CampaignHostDecisions({ campaignId }: { campaignId: string }) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const query = useHostDecisions(campaignId, open);
  const decide = useDecideForHost(campaignId);
  const rows = sortHostDecisions(query.data?.hosts ?? []);

  const answer = async (row: HostDecisionRow, kind: 'accept' | 'refuse') => {
    try {
      await decide.mutateAsync({ kind: row.kind, allocationId: row.allocation_id, answer: kind });
      toast.success(
        kind === 'accept'
          ? `Accepté pour ${row.screenhost_name}. Le Host en est informé.`
          : `Refusé pour ${row.screenhost_name}. Le Host en est informé.`,
      );
    } catch (error) {
      toast.error(getErrorMessage(error) || 'La réponse n’a pas pu être enregistrée.');
    } finally {
      setConfirming(null);
    }
  };

  return (
    <div className="rounded-lg border border-gray-200 p-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 text-left text-sm font-medium text-gray-700"
      >
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        <UserCheck className="h-4 w-4 text-brand-primary" />
        Réponses des Hosts
        {query.data && (
          <span className="ml-auto text-xs font-normal text-gray-500">
            {hostDecisionSummary(query.data.hosts)}
          </span>
        )}
      </button>

      {open && (
        <div className="mt-3 space-y-2">
          <p className="text-xs text-gray-500">
            Répondez à la place d’un Host qui n’a pas encore accepté ou refusé. Le Host reçoit une
            notification indiquant que l’équipe Toodooh a répondu pour lui.
          </p>
          {query.isLoading ? (
            <div className="flex items-center gap-2 py-4 text-sm text-gray-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Chargement…
            </div>
          ) : query.isError ? (
            <p className="text-sm text-red-600">Impossible de charger les réponses des Hosts.</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-gray-500">
              Cette campagne n’a encore été proposée à aucun Host.
            </p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {rows.map((row) => (
                <li key={row.allocation_id} className="py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-gray-900">
                        {row.screenhost_name}
                      </p>
                      <p className="text-xs text-gray-500">
                        {row.owner_label ?? 'Propriétaire inconnu'} · {TND(row.owner_share_tnd)}
                      </p>
                    </div>
                    <span
                      className={`rounded-md px-1.5 py-0.5 text-xs font-medium ${PILL[row.statut]}`}
                    >
                      {HOST_DECISION_LABEL[row.statut]}
                    </span>
                    {canAnswerForHost(row) && confirming !== row.allocation_id && (
                      <div className="flex gap-2">
                        <button
                          type="button"
                          disabled={decide.isPending}
                          onClick={() => setConfirming(row.allocation_id)}
                          className="h-8 rounded-lg border border-gray-200 bg-white px-3 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                        >
                          Refuser
                        </button>
                        <button
                          type="button"
                          disabled={decide.isPending}
                          onClick={() => void answer(row, 'accept')}
                          className="h-8 rounded-lg bg-brand-primary px-3 text-xs font-semibold text-brand-deep hover:bg-brand-primary/90 disabled:opacity-50"
                        >
                          Accepter
                        </button>
                      </div>
                    )}
                  </div>
                  {confirming === row.allocation_id && (
                    <div className="mt-2 rounded-lg bg-red-50 p-2">
                      <p className="text-xs text-red-800">
                        {refuseForHostQuestion(row.screenhost_name)}
                      </p>
                      <div className="mt-2 flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setConfirming(null)}
                          className="h-8 rounded-lg border border-gray-200 bg-white px-3 text-xs font-medium text-gray-700"
                        >
                          Annuler
                        </button>
                        <button
                          type="button"
                          disabled={decide.isPending}
                          onClick={() => void answer(row, 'refuse')}
                          className="h-8 rounded-lg bg-red-600 px-3 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                        >
                          Confirmer le refus
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
