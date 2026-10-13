import { Loader2, UserCheck } from 'lucide-react';
import { useState } from 'react';

import AdminLayout from '@/features/admin/components/AdminLayout';
import { AgentCgePanel } from '@/features/admin/components/agents/AgentCgePanel';
import { AgentPayoutsPanel } from '@/features/admin/components/agents/AgentPayoutsPanel';
import { AgentRibQueue } from '@/features/admin/components/agents/AgentRibQueue';
import { AgentSheetDrawer } from '@/features/admin/components/agents/AgentSheetDrawer';
import { AgentsTable } from '@/features/admin/components/agents/AgentsTable';
import { useAgentsList } from '@/features/admin/hooks/useAdminAgents';

// AGT-1 (agent specs v1.0 §2, ruling Q1 A) — « Agents »: every Agent Screencaster and Agent
// Screenhost with its account status and onboarding progress (the sheet opens in a drawer), the
// monthly payouts (AGT-3), the RIB validation queue and the CGE versions. Agents are created from « Créer rôle ».

const TABS = [
  ['list', 'Agents'],
  ['payouts', 'Versements'],
  ['ribs', 'RIB'],
  ['cge', 'CGE'],
] as const;

export default function AgentsManagement() {
  const [tab, setTab] = useState<(typeof TABS)[number][0]>('list');
  const [openId, setOpenId] = useState<string | null>(null);
  const list = useAgentsList();

  return (
    <AdminLayout title="Agents">
      <div className="mx-auto max-w-6xl space-y-4 p-4">
        <header className="flex items-center gap-3">
          <UserCheck className="h-6 w-6 text-brand-primary" />
          <div>
            <h1 className="text-xl font-semibold">Agents</h1>
            <p className="text-sm text-gray-500">
              Fiches, statuts et onboarding des agents, versements, validation des RIB et
              publication des CGE.
            </p>
          </div>
        </header>
        <div className="rounded-xl border bg-white">
          <div className="flex gap-2 border-b px-4 pt-3">
            {TABS.map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={`px-3 py-2 text-sm ${tab === key ? 'border-b-2 border-brand-primary font-semibold' : 'text-gray-500'}`}
              >
                {label}
              </button>
            ))}
          </div>
          {tab === 'list' &&
            (list.isLoading ? (
              <Loader2 className="mx-auto my-10 h-6 w-6 animate-spin text-brand-primary" />
            ) : (
              <AgentsTable agents={list.data?.agents ?? []} onOpen={setOpenId} />
            ))}
          {tab === 'payouts' && <AgentPayoutsPanel />}
          {tab === 'ribs' && <AgentRibQueue />}
          {tab === 'cge' && <AgentCgePanel />}
        </div>
      </div>
      {openId && <AgentSheetDrawer id={openId} onClose={() => setOpenId(null)} />}
    </AdminLayout>
  );
}
