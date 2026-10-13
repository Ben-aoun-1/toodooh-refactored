import { useState } from 'react';
import { toast } from 'react-hot-toast';

import {
  useAffiliationAction,
  useAgentAffiliations,
  useAgentsList,
  useAttentionEvents,
} from '@/features/admin/hooks/useAdminAgents';
import {
  AFFILIATION_STATUS_FR,
  EXCLUSION_FR,
  affiliationIsLive,
  affiliationWindowLabel,
} from '@/features/admin/lib/agent-sheet';
import type {
  AffiliationAction,
  AgentAffiliationRow,
  AgentRoleKey,
} from '@/features/admin/services/admin-agents.service';
import { getErrorMessage } from '@/lib/errors';

const input = 'mt-1 w-full rounded-lg border px-3 py-2 text-sm';

/**
 * AGT-2 (agent specs v1.0 §6 « Gérer les affiliations depuis le hub ») — the agent's portfolio
 * with the hub actions on each live affiliation: avenant (new end date), « exploité par l'agent »
 * (Screenhost only, with the convention reference), reassignment to another agent of the same
 * type, exclusion.
 */
export function AgentAffiliationsPanel({ agentId, role }: { agentId: string; role: AgentRoleKey }) {
  const list = useAgentAffiliations(agentId);
  const [openId, setOpenId] = useState<string | null>(null);
  const rows = list.data?.affiliations ?? [];

  return (
    <section>
      <p className="text-sm font-semibold">
        Affiliations ({rows.filter((r) => affiliationIsLive(r.status)).length} actives)
      </p>
      {rows.length === 0 ? (
        <p className="mt-1 text-sm text-gray-500">Aucune affiliation.</p>
      ) : (
        <ul className="mt-2 divide-y rounded-lg border">
          {rows.map((r) => (
            <li key={r.id} className="p-3 text-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium">{r.name}</p>
                  <p className="text-gray-500">
                    {affiliationWindowLabel(r.start_date, r.end_date)}
                  </p>
                  {r.exploited_by_agent && (
                    <p className="text-gray-500">
                      Exploité par l’agent{r.convention_ref ? ` — ${r.convention_ref}` : ''}
                    </p>
                  )}
                </div>
                <div className="text-right">
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs">
                    {AFFILIATION_STATUS_FR[r.status]}
                  </span>
                  {r.exclusion_reason && (
                    <p className="mt-1 text-xs text-gray-500">
                      {EXCLUSION_FR[r.exclusion_reason] ?? r.exclusion_reason}
                    </p>
                  )}
                  {affiliationIsLive(r.status) && (
                    <button
                      type="button"
                      onClick={() => setOpenId(openId === r.id ? null : r.id)}
                      className="mt-1 block text-xs font-medium text-brand-primary"
                    >
                      {openId === r.id ? 'Fermer' : 'Gérer'}
                    </button>
                  )}
                </div>
              </div>
              {openId === r.id && <AffiliationActions row={r} role={role} agentId={agentId} />}
              {openId === r.id && r.kind === 'screenhost' && (
                <AttentionHistory affiliationId={r.id} />
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function AffiliationActions({
  row,
  role,
  agentId,
}: {
  row: AgentAffiliationRow;
  role: AgentRoleKey;
  agentId: string;
}) {
  const action = useAffiliationAction();
  const agents = useAgentsList();
  const [endDate, setEndDate] = useState(row.end_date ?? '');
  const [convention, setConvention] = useState(row.convention_ref ?? '');
  const [target, setTarget] = useState('');
  const [reason, setReason] = useState<'key_account' | 'secteur_reserve' | 'exclu'>('exclu');
  const peers = (agents.data?.agents ?? []).filter(
    (a) => a.role === role && a.id !== agentId && a.account_status === 'actif',
  );

  const run = async (a: AffiliationAction, ok: string) => {
    try {
      await action.mutateAsync({ id: row.id, action: a });
      toast.success(ok);
    } catch (e) {
      toast.error(getErrorMessage(e) || 'Action impossible');
    }
  };

  const button = 'rounded-lg border px-3 py-2 text-sm disabled:opacity-50';

  return (
    <div className="mt-3 space-y-3 rounded-lg bg-gray-50 p-3">
      {row.start_date && (
        <label className="block">
          <span className="text-gray-600">Avenant — nouvelle date de fin</span>
          <div className="flex gap-2">
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className={input}
            />
            <button
              type="button"
              disabled={!endDate || action.isPending}
              onClick={() => void run({ kind: 'avenant', end_date: endDate }, 'Avenant enregistré')}
              className={`${button} mt-1`}
            >
              Appliquer
            </button>
          </div>
        </label>
      )}

      {row.kind === 'screenhost' && (
        <label className="block">
          <span className="text-gray-600">Référence de la convention d’exploitation</span>
          <div className="flex gap-2">
            <input
              value={convention}
              onChange={(e) => setConvention(e.target.value)}
              className={input}
            />
            <button
              type="button"
              disabled={action.isPending}
              onClick={() =>
                void run(
                  {
                    kind: 'exploited',
                    exploited: !row.exploited_by_agent,
                    convention_ref: convention.trim() || null,
                  },
                  row.exploited_by_agent ? 'Exploitation retirée' : 'Marqué exploité par l’agent',
                )
              }
              className={`${button} mt-1 whitespace-nowrap`}
            >
              {row.exploited_by_agent ? 'Retirer' : 'Exploité par l’agent'}
            </button>
          </div>
        </label>
      )}

      <label className="block">
        <span className="text-gray-600">Réaffecter à un autre agent</span>
        <div className="flex gap-2">
          <select value={target} onChange={(e) => setTarget(e.target.value)} className={input}>
            <option value="">Choisir…</option>
            {peers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.contact_name} ({p.code})
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={!target || action.isPending}
            onClick={() =>
              void run({ kind: 'reassign', agent_user_id: target }, 'Affiliation réaffectée')
            }
            className={`${button} mt-1`}
          >
            Réaffecter
          </button>
        </div>
      </label>

      <label className="block">
        <span className="text-gray-600">Exclure l’affilié</span>
        <div className="flex gap-2">
          <select
            value={reason}
            onChange={(e) => setReason(e.target.value as typeof reason)}
            className={input}
          >
            <option value="exclu">{EXCLUSION_FR.exclu}</option>
            <option value="key_account">{EXCLUSION_FR.key_account}</option>
            <option value="secteur_reserve">{EXCLUSION_FR.secteur_reserve}</option>
          </select>
          <button
            type="button"
            disabled={action.isPending}
            onClick={() => void run({ kind: 'exclude', reason }, 'Affilié exclu')}
            className={`${button} mt-1 border-red-300 text-red-700`}
          >
            Exclure
          </button>
        </div>
      </label>
    </div>
  );
}

/** AGT-7 — the venue's attention points, appeared and cleared (spec §6, visible in the hub). */
function AttentionHistory({ affiliationId }: { affiliationId: string }) {
  const events = useAttentionEvents(affiliationId);
  const rows = events.data?.events ?? [];
  return (
    <div className="mt-3 rounded-lg border p-3 text-sm">
      <p className="font-medium">Points d’attention</p>
      {rows.length === 0 ? (
        <p className="text-gray-500">Aucun point d’attention.</p>
      ) : (
        <ul className="mt-1 space-y-1">
          {rows.map((e) => (
            <li key={e.id} className="flex justify-between gap-2">
              <span>{e.label}</span>
              <span className="text-xs text-gray-500">
                {new Date(e.appeared_at).toLocaleDateString('fr-FR')}
                {' → '}
                {e.cleared_at ? new Date(e.cleared_at).toLocaleDateString('fr-FR') : 'actif'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
