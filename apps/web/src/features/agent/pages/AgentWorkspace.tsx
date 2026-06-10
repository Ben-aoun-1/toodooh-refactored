import { CheckCircle2, Users, Wallet } from 'lucide-react';
import { useMemo } from 'react';

import AgentClientCard from '@/features/agent/components/AgentClientCard';
import AgentLayout from '@/features/agent/components/AgentLayout';
import { useAgentClients } from '@/features/agent/hooks/useAgentClients';
import { toReferenceLookup } from '@/features/agent/utils/client-display';
import { useGovernorates } from '@/features/auth/hooks/useGovernorates';
import { useOwnerBusinessSectors } from '@/features/auth/hooks/useOwnerBusinessSectors';
import { useSectors } from '@/features/auth/hooks/useSectors';
import { apiErrorMessage } from '@/features/auth/services/auth-errors';
import { useAuthStore } from '@/features/auth/stores/auth.store';

// P2 — the real referred-clients dashboard (replaces the CF-19 read-only stub). The list comes
// from GET /api/agent/clients. Commission and accepted/refused stay EXPLICIT placeholders: their
// data source (the future wedooh affluence edge) is not repointed yet — no fabricated numbers
// (CF-18 ruling 18). Read-only: no create/edit/delete, no documents (absent by API design).
const PLACEHOLDER = '—';

export default function AgentWorkspace() {
  const contactName = useAuthStore((s) => s.contactName);
  const clientsQuery = useAgentClients();

  // Reference lookups (session-static) so the cards show names, never raw UUIDs. Both sector
  // audiences are merged: a screenhost_agent's clients carry owner sectors, a screencast_agent's
  // carry advertiser sectors — ids come from one table, so the merge cannot collide.
  const governoratesQuery = useGovernorates();
  const ownerSectorsQuery = useOwnerBusinessSectors();
  const advertiserSectorsQuery = useSectors();

  const governorates = useMemo(
    () => toReferenceLookup(governoratesQuery.data),
    [governoratesQuery.data],
  );
  const sectors = useMemo(
    () =>
      toReferenceLookup([
        ...(ownerSectorsQuery.data ?? []),
        ...(advertiserSectorsQuery.data ?? []),
      ]),
    [ownerSectorsQuery.data, advertiserSectorsQuery.data],
  );

  const clients = clientsQuery.data;

  const stats = [
    {
      label: 'Clients référés',
      value: clients ? String(clients.length) : PLACEHOLDER,
      Icon: Users,
      pending: false,
    },
    {
      label: 'Annonces acceptées / refusées',
      value: PLACEHOLDER,
      Icon: CheckCircle2,
      pending: true,
    },
    { label: 'Commission', value: PLACEHOLDER, Icon: Wallet, pending: true },
  ];

  return (
    <AgentLayout
      title={`Bonjour, ${contactName ?? 'Agent'}`}
      subtitle="Suivez les clients inscrits via votre code agent"
    >
      <div className="space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {stats.map(({ label, value, Icon, pending }) => (
            <div key={label} className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500">{label}</p>
                  <p className="text-2xl font-bold text-gray-900 mt-1 tabular-nums">{value}</p>
                  {/* Explicit placeholder marker — the metric's data source is not wired yet. */}
                  {pending && <p className="text-xs text-gray-400 mt-1">Bientôt disponible</p>}
                </div>
                <Icon className="h-8 w-8 text-gray-300" />
              </div>
            </div>
          ))}
        </div>

        <section className="bg-white rounded-xl shadow-sm border border-gray-200">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">Clients référés</h2>
          </div>

          {clientsQuery.isLoading && (
            <div className="px-6 py-16 text-center">
              <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-brand-primary mx-auto mb-3"></div>
              <p className="text-sm text-gray-600">Chargement des clients...</p>
            </div>
          )}

          {clientsQuery.isError && (
            <div className="px-6 py-16 text-center">
              <p className="text-sm text-red-600">{apiErrorMessage(clientsQuery.error)}</p>
            </div>
          )}

          {clients && clients.length === 0 && (
            <div className="px-6 py-16 text-center">
              <Users className="h-10 w-10 text-gray-300 mx-auto mb-3" />
              <p className="text-sm text-gray-600">
                Vos clients référés apparaîtront ici dès qu&apos;ils s&apos;inscrivent avec votre
                code agent.
              </p>
            </div>
          )}

          {clients && clients.length > 0 && (
            <ul className="divide-y divide-gray-200">
              {clients.map((client) => (
                <AgentClientCard
                  key={client.id}
                  client={client}
                  governorates={governorates}
                  sectors={sectors}
                />
              ))}
            </ul>
          )}
        </section>
      </div>
    </AgentLayout>
  );
}
