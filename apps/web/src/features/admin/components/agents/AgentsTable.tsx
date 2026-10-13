import { AGENT_STATUS_FR, onboardingLabel } from '@/features/admin/lib/agent-sheet';
import type { AgentListRow } from '@/features/admin/services/admin-agents.service';

const ROLE_FR = { screenhost_agent: 'Agent Screenhost', screencast_agent: 'Agent Screencaster' };

const STATUS_CLASS: Record<AgentListRow['account_status'], string> = {
  en_attente: 'bg-amber-50 text-amber-700',
  actif: 'bg-emerald-50 text-emerald-700',
  suspendu: 'bg-orange-50 text-orange-700',
  cloture: 'bg-gray-100 text-gray-600',
};

/** AGT-1 — the agents list: name, type, code, account status, onboarding progress. */
export function AgentsTable({
  agents,
  onOpen,
}: {
  agents: AgentListRow[];
  onOpen: (id: string) => void;
}) {
  if (agents.length === 0) {
    return <p className="p-6 text-center text-sm text-gray-500">Aucun agent pour le moment.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
          <tr>
            <th className="px-4 py-3">Agent</th>
            <th className="px-4 py-3">Type</th>
            <th className="px-4 py-3">Code</th>
            <th className="px-4 py-3">Statut</th>
            <th className="px-4 py-3">Onboarding</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {agents.map((a) => (
            <tr key={a.id} className="hover:bg-gray-50">
              <td className="px-4 py-3">
                <button
                  type="button"
                  onClick={() => onOpen(a.id)}
                  className="text-left font-medium text-gray-900 hover:text-brand-primary"
                >
                  {a.contact_name}
                </button>
                <p className="text-gray-500">{a.email}</p>
              </td>
              <td className="px-4 py-3">{ROLE_FR[a.role]}</td>
              <td className="px-4 py-3 font-mono">{a.code}</td>
              <td className="px-4 py-3">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs ${STATUS_CLASS[a.account_status]}`}
                >
                  {AGENT_STATUS_FR[a.account_status]}
                </span>
              </td>
              <td className="px-4 py-3">{onboardingLabel(a.onboarding)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
