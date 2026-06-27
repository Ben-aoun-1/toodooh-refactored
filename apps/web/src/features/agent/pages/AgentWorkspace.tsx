import { Eye, KeyRound, Trophy, Users, Wallet } from 'lucide-react';
import { useMemo } from 'react';

import AgentClientCard from '@/features/agent/components/AgentClientCard';
import AgentLayout from '@/features/agent/components/AgentLayout';
import { useAgentClients } from '@/features/agent/hooks/useAgentClients';
import {
  AGENT_DASHBOARD_PLACEHOLDER,
  agentAudienceLabels,
  agentCodeDisplay,
  agentKpiCards,
} from '@/features/agent/utils/agent-dashboard';
import { toReferenceLookup } from '@/features/agent/utils/client-display';
import { useGovernorates } from '@/features/auth/hooks/useGovernorates';
import { useOwnerBusinessSectors } from '@/features/auth/hooks/useOwnerBusinessSectors';
import { useSectors } from '@/features/auth/hooks/useSectors';
import { apiErrorMessage } from '@/features/auth/services/auth-errors';
import { useAuthStore } from '@/features/auth/stores/auth.store';

// R5 — the agent dashboard, re-laid-out to match the Figma. MOST of the dashboard (revenue/wallet,
// campaigns, impressions, ranking, appointments, notifications) is greenfield → it renders EXPLICIT
// "à venir" placeholders with NO fabricated numbers (CF-18). Only what an existing API already returns
// is LIVE: the header name (session) + the affiliated-clients list/count (GET /api/agent/clients).
// The screenhost↔screencast wording swaps by role (agentAudienceLabels). Layout is build-verified —
// the web suite has no render harness; the testable view-model lives in utils/agent-dashboard.

// KPI accent tones, by card key — standard Tailwind families (no inline hex), echoing the owner
// dashboard's pastel KPI row.
const KPI_TONE: Record<string, string> = {
  revenue_total: 'bg-amber-50 border-amber-200',
  affiliates: 'bg-emerald-50 border-emerald-200',
  impressions: 'bg-sky-50 border-sky-200',
  ranking: 'bg-violet-50 border-violet-200',
};

const KPI_ICON: Record<string, typeof Wallet> = {
  revenue_total: Wallet,
  affiliates: Users,
  impressions: Eye,
  ranking: Trophy,
};

// A greenfield section: the title with an honest empty state. NO fabricated rows.
function PlaceholderSection({ title }: { title: string }) {
  return (
    <section className="rounded-2xl border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-200 px-6 py-4">
        <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
      </div>
      <div className="px-6 py-12 text-center">
        <p className="text-sm text-gray-500">Bientôt disponible</p>
        <p className="mt-1 text-xs text-gray-400">Cette section sera disponible prochainement.</p>
      </div>
    </section>
  );
}

export default function AgentWorkspace() {
  const contactName = useAuthStore((s) => s.contactName);
  const role = useAuthStore((s) => s.role);
  const agentCode = useAuthStore((s) => s.agentCode);
  const labels = agentAudienceLabels(role);
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
  const kpis = agentKpiCards(clients ? clients.length : null, labels);

  return (
    <AgentLayout title={`Bonjour, ${contactName ?? 'Agent'}`} subtitle={labels.subtitle}>
      <div className="space-y-6">
        {/* Top cards: Revenu actuel (PLACEHOLDER, dark) · CODE AGENT (PLACEHOLDER — see below, green) */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex min-h-[140px] flex-col justify-center rounded-2xl bg-brand-deep p-6 shadow-sm">
            <div className="flex items-center gap-2 text-white/80">
              <Wallet className="h-5 w-5" />
              <p className="text-sm font-medium">Revenu actuel</p>
            </div>
            <p className="mt-3 text-2xl font-bold text-white">
              {AGENT_DASHBOARD_PLACEHOLDER}
              <span className="ml-1 text-base font-medium text-white/70">TND</span>
            </p>
            <p className="mt-1 text-xs text-white/60">Bientôt disponible</p>
          </div>

          {/* CODE AGENT — the agent's own issued code, LIVE from /api/me|/api/signin (store.agentCode).
              Absent (non-agent / not yet provisioned) → the placeholder glyph, never fabricated. */}
          <div className="flex min-h-[140px] flex-col justify-center rounded-2xl bg-brand-primary p-6 shadow-sm">
            <div className="flex items-center gap-2 text-brand-deep/80">
              <KeyRound className="h-5 w-5" />
              <p className="text-sm font-medium">Code agent</p>
            </div>
            <p className="mt-3 text-2xl font-bold tracking-wide text-brand-deep">
              {agentCodeDisplay(agentCode)}
            </p>
          </div>
        </div>

        {/* Four KPI cards — only "{noun} affiliés" is live; the rest are explicit placeholders. */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {kpis.map((kpi) => {
            const Icon = KPI_ICON[kpi.key] ?? Wallet;
            return (
              <div
                key={kpi.key}
                className={`flex min-h-[120px] flex-col rounded-xl border p-5 ${
                  KPI_TONE[kpi.key] ?? 'bg-gray-50 border-gray-200'
                }`}
              >
                <div className="flex items-center justify-between">
                  <p className="text-sm text-gray-600">{kpi.label}</p>
                  <Icon className="h-5 w-5 flex-shrink-0 text-gray-400" />
                </div>
                <p className="mt-2 text-2xl font-bold tabular-nums text-gray-900">{kpi.value}</p>
                {/* The Figma shows a ±% delta vs the previous year — greenfield, so render an honest
                    placeholder; live metrics omit it. */}
                {kpi.live ? null : (
                  <p className="mt-auto pt-2 text-xs text-gray-400">Bientôt disponible</p>
                )}
              </div>
            );
          })}
        </div>

        {/* Mes {noun} affiliés — LIVE (GET /api/agent/clients), reusing AgentClientCard. */}
        <section id="affilies" className="rounded-2xl border border-gray-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
            <h2 className="text-lg font-semibold text-gray-900">{labels.affiliatesSection}</h2>
            {/* No dedicated list page yet — the full list already renders below, so "Voir tous" is a
                disabled affordance, not a dead link. */}
            <span className="cursor-not-allowed text-sm font-medium text-gray-400">Voir tous</span>
          </div>

          {clientsQuery.isLoading && (
            <div className="px-6 py-16 text-center">
              <div className="mx-auto mb-3 h-10 w-10 animate-spin rounded-full border-b-2 border-brand-primary"></div>
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
              <Users className="mx-auto mb-3 h-10 w-10 text-gray-300" />
              <p className="text-sm text-gray-600">
                Vos {labels.noun.toLowerCase()} affiliés apparaîtront ici dès qu&apos;ils
                s&apos;inscrivent avec votre code agent.
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

        {/* Greenfield sections — explicit placeholders, no fabricated data. */}
        <PlaceholderSection title="Mes campagnes affiliées en cours" />
        <PlaceholderSection title="Mes rendez-vous" />
        <PlaceholderSection title="Notifications" />
      </div>
    </AgentLayout>
  );
}
