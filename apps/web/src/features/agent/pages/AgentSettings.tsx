import { Loader2 } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';

import AgentLayout from '@/features/agent/components/AgentLayout';
import { LegalTab } from '@/features/agent/components/settings/LegalTab';
import { NotificationsTab } from '@/features/agent/components/settings/NotificationsTab';
import { ProfileTab } from '@/features/agent/components/settings/ProfileTab';
import { SecurityTab } from '@/features/agent/components/settings/SecurityTab';
import { useAgentAccount, useAgentProfile } from '@/features/agent/hooks/useAgentAccount';
import { SETTINGS_TABS, settingsTabOf } from '@/features/agent/lib/agent-shell';

// AGT-1b (agent specs v1.0 §9) — « Paramètres »: four tabs, deep-linkable (?tab=) so each step of
// « Finalisez votre compte » opens the right one.
export default function AgentSettings() {
  const [params, setParams] = useSearchParams();
  const tab = settingsTabOf(params.get('tab'));
  const account = useAgentAccount();
  const profile = useAgentProfile();
  const p = profile.data;
  const a = account.data;
  // Remount the forms whenever the saved values change, so they start from them.
  const version = p ? JSON.stringify(p) : '';

  return (
    <AgentLayout page="settings">
      <div className="rounded-xl border border-[#E1E4EA] bg-white">
        <div className="flex flex-wrap gap-2 border-b border-[#E1E4EA] px-4 pt-3">
          {SETTINGS_TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setParams({ tab: t.key })}
              className={`px-3 py-2 text-sm ${tab === t.key ? 'border-b-2 border-brand-primary font-semibold' : 'text-[#5C5C5C]'}`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="p-5">
          {!p || !a ? (
            <Loader2 className="mx-auto my-10 h-6 w-6 animate-spin text-brand-primary" />
          ) : (
            <>
              {tab === 'profil' && <ProfileTab key={version} profile={p} />}
              {tab === 'legal' && <LegalTab key={version} profile={p} account={a} />}
              {tab === 'notifications' && <NotificationsTab profile={p} />}
              {tab === 'securite' && <SecurityTab profile={p} />}
            </>
          )}
        </div>
      </div>
    </AgentLayout>
  );
}
