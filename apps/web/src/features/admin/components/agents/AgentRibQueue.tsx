import { ExternalLink } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'react-hot-toast';

import { useAgentRibs, useDecideRib } from '@/features/admin/hooks/useAdminAgents';
import { adminAgentsService } from '@/features/admin/services/admin-agents.service';
import { getErrorMessage } from '@/lib/errors';

const TABS = [
  ['en_attente', 'À valider'],
  ['valide', 'Validés'],
  ['refuse', 'Refusés'],
] as const;

/** AGT-1 — the agents' RIB deposits; validating or refusing notifies the agent. */
export function AgentRibQueue() {
  const [status, setStatus] = useState<(typeof TABS)[number][0]>('en_attente');
  const ribs = useAgentRibs(status);
  const decide = useDecideRib();
  const [refusing, setRefusing] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  const open = async (id: string) => {
    try {
      const { url } = await adminAgentsService.ribUrl(id);
      window.open(url, '_blank', 'noopener');
    } catch (e) {
      toast.error(getErrorMessage(e) || 'Fichier indisponible');
    }
  };

  const act = async (id: string, decision: 'valide' | 'refuse') => {
    if (decision === 'refuse' && !reason.trim()) {
      toast.error('Indiquez le motif du refus.');
      return;
    }
    try {
      await decide.mutateAsync({ id, decision, reason: reason.trim() });
      await ribs.refetch();
      setRefusing(null);
      setReason('');
      toast.success(decision === 'valide' ? 'RIB validé' : 'RIB refusé');
    } catch (e) {
      toast.error(getErrorMessage(e) || 'Action impossible');
    }
  };

  return (
    <div>
      <div className="flex gap-2 border-b px-4 pt-3">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setStatus(key)}
            className={`px-3 py-2 text-sm ${status === key ? 'border-b-2 border-brand-primary font-semibold' : 'text-gray-500'}`}
          >
            {label}
          </button>
        ))}
      </div>
      {(ribs.data?.ribs ?? []).length === 0 ? (
        <p className="p-6 text-center text-sm text-gray-500">Aucun RIB.</p>
      ) : (
        <ul className="divide-y">
          {(ribs.data?.ribs ?? []).map((r) => (
            <li key={r.id} className="space-y-2 p-4 text-sm">
              <div className="flex flex-wrap items-center gap-3">
                <span className="font-medium">{r.agent_name}</span>
                <span className="font-mono text-gray-500">{r.agent_code}</span>
                <span className="text-gray-500">
                  {new Date(r.submitted_at).toLocaleDateString('fr-FR')}
                </span>
                <button
                  type="button"
                  onClick={() => void open(r.id)}
                  className="flex items-center gap-1 text-brand-primary"
                >
                  <ExternalLink className="h-4 w-4" />
                  {r.file_name}
                </button>
                {r.refusal_reason && (
                  <span className="text-red-700">Motif : {r.refusal_reason}</span>
                )}
                {r.status === 'en_attente' && (
                  <span className="ml-auto flex gap-2">
                    <button
                      type="button"
                      onClick={() => void act(r.id, 'valide')}
                      className="rounded-lg bg-brand-primary px-3 py-1.5 font-medium text-brand-deep"
                    >
                      Valider
                    </button>
                    <button
                      type="button"
                      onClick={() => setRefusing(refusing === r.id ? null : r.id)}
                      className="rounded-lg border border-red-300 px-3 py-1.5 text-red-700"
                    >
                      Refuser
                    </button>
                  </span>
                )}
              </div>
              {refusing === r.id && (
                <div className="flex gap-2">
                  <input
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Motif du refus (envoyé à l’agent)"
                    className="flex-1 rounded-lg border px-3 py-1.5"
                  />
                  <button
                    type="button"
                    onClick={() => void act(r.id, 'refuse')}
                    className="rounded-lg bg-red-600 px-3 py-1.5 text-white"
                  >
                    Confirmer le refus
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
