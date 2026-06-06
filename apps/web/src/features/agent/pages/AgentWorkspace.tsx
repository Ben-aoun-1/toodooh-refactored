import { CheckCircle2, Users, Wallet } from 'lucide-react';

import AgentLayout from '@/features/agent/components/AgentLayout';
import { useAuthStore } from '@/features/auth/stores/auth.store';

// CF-19 P0 — read-only referred-clients dashboard STUB. Agents do NOT create establishments (that
// create surface was removed). This shows the shape of the referred-clients view; normalized
// referral tracking + real per-client/per-campaign stats land in P1/P2 (agent_referrals table +
// GET /api/agent/clients). No documents, no create/edit/delete, no Supabase. Commission stays a
// placeholder until the pricing model is defined (CF-18 ruling 18) — no fabricated numbers.
const PLACEHOLDER = '—';

export default function AgentWorkspace() {
  const contactName = useAuthStore((s) => s.contactName);

  const stats = [
    { label: 'Clients référés', value: PLACEHOLDER, Icon: Users },
    { label: 'Annonces acceptées / refusées', value: PLACEHOLDER, Icon: CheckCircle2 },
    { label: 'Commission', value: PLACEHOLDER, Icon: Wallet },
  ];

  return (
    <AgentLayout
      title={`Bonjour, ${contactName ?? 'Agent'}`}
      subtitle="Suivez les clients inscrits via votre code agent"
    >
      <div className="space-y-6">
        {/* Placeholder metric cards — no fabricated numbers until referral tracking + pricing land. */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {stats.map(({ label, value, Icon }) => (
            <div key={label} className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500">{label}</p>
                  <p className="text-2xl font-bold text-gray-900 mt-1 tabular-nums">{value}</p>
                </div>
                <Icon className="h-8 w-8 text-gray-300" />
              </div>
            </div>
          ))}
        </div>

        {/* Referred clients — read-only, empty state */}
        <section className="bg-white rounded-xl shadow-sm border border-gray-200">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">Clients référés</h2>
          </div>
          <div className="px-6 py-16 text-center">
            <Users className="h-10 w-10 text-gray-300 mx-auto mb-3" />
            <p className="text-sm text-gray-600">
              Vos clients référés apparaîtront ici dès qu&apos;ils s&apos;inscrivent avec votre code
              agent.
            </p>
            <p className="text-xs text-gray-400 mt-2">
              Le suivi des référencements (clients, statistiques d&apos;annonces, commission) sera
              activé prochainement.
            </p>
          </div>
        </section>
      </div>
    </AgentLayout>
  );
}
