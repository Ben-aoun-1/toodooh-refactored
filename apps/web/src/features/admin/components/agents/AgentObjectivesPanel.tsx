import { useState } from 'react';
import { toast } from 'react-hot-toast';

import {
  useAddObjective,
  useAgentObjectives,
  usePatchObjective,
} from '@/features/admin/hooks/useAdminAgents';
import type { AgentRoleKey } from '@/features/admin/services/admin-agents.service';
import { getErrorMessage } from '@/lib/errors';

const ROLES: [AgentRoleKey, string][] = [
  ['screencast_agent', 'Agent Screencaster'],
  ['screenhost_agent', 'Agent Screenhost'],
];

/**
 * AGT-5 (agent specs v1.0 §7 « Objectifs de rendez-vous ») — the appointment reasons per agent
 * type, shared by the affiliates' booking modal and the agents' cards. A reason is deactivated,
 * never deleted (past appointments keep their label).
 */
export function AgentObjectivesPanel() {
  const list = useAgentObjectives();
  const add = useAddObjective();
  const patch = usePatchObjective();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const rows = list.data?.objectives ?? [];

  const run = async (p: Promise<unknown>, ok: string) => {
    try {
      await p;
      toast.success(ok);
    } catch (e) {
      toast.error(getErrorMessage(e) || 'Action impossible');
    }
  };

  return (
    <div className="grid grid-cols-1 gap-6 p-4 md:grid-cols-2">
      {ROLES.map(([role, title]) => (
        <section key={role}>
          <p className="mb-2 text-sm font-semibold">{title}</p>
          <ul className="divide-y rounded-lg border">
            {rows
              .filter((o) => o.agent_role === role)
              .map((o) => (
                <li
                  key={o.id}
                  className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                >
                  <span className={o.active ? '' : 'text-gray-400 line-through'}>{o.label}</span>
                  <button
                    type="button"
                    onClick={() =>
                      void run(
                        patch.mutateAsync({ id: o.id, body: { active: !o.active } }),
                        o.active ? 'Objectif désactivé' : 'Objectif réactivé',
                      )
                    }
                    className="text-xs font-medium text-brand-primary"
                  >
                    {o.active ? 'Désactiver' : 'Réactiver'}
                  </button>
                </li>
              ))}
          </ul>
          <div className="mt-2 flex gap-2">
            <input
              value={drafts[role] ?? ''}
              onChange={(e) => setDrafts((d) => ({ ...d, [role]: e.target.value }))}
              placeholder="Nouvel objectif"
              className="flex-1 rounded-lg border px-3 py-2 text-sm"
            />
            <button
              type="button"
              disabled={!(drafts[role] ?? '').trim() || add.isPending}
              onClick={() =>
                void run(
                  add.mutateAsync({ role, label: (drafts[role] ?? '').trim() }),
                  'Objectif ajouté',
                ).then(() => setDrafts((d) => ({ ...d, [role]: '' })))
              }
              className="rounded-lg bg-brand-primary px-3 py-2 text-sm font-medium text-brand-deep disabled:opacity-50"
            >
              Ajouter
            </button>
          </div>
        </section>
      ))}
    </div>
  );
}
