import { Loader2, Users } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import AgentLayout from '@/features/agent/components/AgentLayout';
import { AgentAvatar } from '@/features/agent/components/portfolio/AgentAvatar';
import { CopyCode } from '@/features/agent/components/portfolio/CopyCode';
import { ShAffiliatesView } from '@/features/agent/components/portfolio/ShAffiliatesView';
import { ViewToggle } from '@/features/agent/components/portfolio/ViewToggle';
import { useAgentAccount } from '@/features/agent/hooks/useAgentAccount';
import { useAgentAffiliates } from '@/features/agent/hooks/useAgentPortfolio';
import { affiliationEnded, frDate } from '@/features/agent/lib/agent-portfolio';
import { AGENT_PATHS, agentKindOf } from '@/features/agent/lib/agent-shell';
import type { AgentAffiliate } from '@/features/agent/services/agent-portfolio.service';
import { useAgentViewStore, viewOf } from '@/features/agent/stores/agent-view.store';
import { useAuthStore } from '@/features/auth/stores/auth.store';
import { formatImpressions } from '@/features/campaigns/lib/campaign-impressions';
import { tndLabel } from '@/lib/money';

const EMPTY =
  'Vous n’avez pas encore de Screencaster affilié. Partagez votre code agent pour rattacher vos premiers annonceurs.';

/**
 * AGT-4 (Agent Screencaster spec v1.0 §6) — the portfolio, read-only: one Screencaster per row,
 * cards (default) or table remembered per agent; a click opens « Mes campagnes » on that
 * Screencaster. An ended affiliation stays listed with « Affiliation terminée ».
 */
function ScAffiliatesView() {
  const navigate = useNavigate();
  const userId = useAuthStore((s) => s.user?.id);
  const views = useAgentViewStore((s) => s.views);
  const setView = useAgentViewStore((s) => s.setView);
  const view = viewOf(views, userId, 'affiliates');
  const query = useAgentAffiliates();
  const account = useAgentAccount();
  const rows = query.data?.affiliates ?? [];
  const openOne = (a: AgentAffiliate) => navigate(`${AGENT_PATHS.campaigns}?affilie=${a.user_id}`);

  const ended = (a: AgentAffiliate) =>
    affiliationEnded(a) ? (
      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
        Affiliation terminée
      </span>
    ) : null;

  return (
    <>
      <div className="space-y-5">
        <div className="flex justify-end">
          <ViewToggle view={view} onChange={(v) => setView(userId ?? '', 'affiliates', v)} />
        </div>
        {query.isLoading ? (
          <Loader2 className="mx-auto my-10 h-6 w-6 animate-spin text-brand-primary" />
        ) : rows.length === 0 ? (
          <div className="rounded-2xl border border-[#E1E4EA] bg-white px-6 py-12 text-center">
            <Users className="mx-auto mb-3 h-10 w-10 text-gray-300" />
            <p className="mx-auto max-w-md text-sm text-gray-600">{EMPTY}</p>
            {account.data?.code && (
              <CopyCode code={account.data.code} className="mt-4 text-lg text-brand-deep" />
            )}
          </div>
        ) : view === 'cards' ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {rows.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => openOne(a)}
                className="flex flex-col gap-3 rounded-xl border border-[#E1E4EA] bg-white p-4 text-left hover:border-brand-primary"
              >
                <div className="flex items-center gap-3">
                  <AgentAvatar name={a.name} />
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{a.name}</p>
                    <p className="text-xs text-gray-500">
                      Du {frDate(a.start_date)} au {frDate(a.end_date)}
                    </p>
                  </div>
                </div>
                {ended(a)}
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <p className="text-xs text-gray-500">Revenus générés</p>
                    <p className="font-semibold">{tndLabel(a.revenue_tnd)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Impressions générées</p>
                    <p className="font-semibold">{formatImpressions(a.impressions)}</p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-[#E1E4EA] bg-white">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-4 py-3">Nom du Screencaster</th>
                  <th className="px-4 py-3">Date d’affiliation</th>
                  <th className="px-4 py-3">Date de fin d’affiliation</th>
                  <th className="px-4 py-3">Revenus générés</th>
                  <th className="px-4 py-3">Impressions générées</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((a) => (
                  <tr key={a.id}>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => openOne(a)}
                        className="flex items-center gap-2 font-medium hover:text-brand-primary"
                      >
                        <AgentAvatar name={a.name} size="sm" />
                        {a.name}
                      </button>
                      {ended(a)}
                    </td>
                    <td className="px-4 py-3">{frDate(a.start_date)}</td>
                    <td className="px-4 py-3">{frDate(a.end_date)}</td>
                    <td className="px-4 py-3">{tndLabel(a.revenue_tnd)}</td>
                    <td className="px-4 py-3">{formatImpressions(a.impressions)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

/** AGT-4 / AGT-7 — « Mes Screencasters » / « Mes Screenhosts » of the agent's type. */
export default function AgentAffiliates() {
  const role = useAuthStore((s) => s.role);
  return (
    <AgentLayout page="affiliates">
      {agentKindOf(role) === 'screenhost' ? <ShAffiliatesView /> : <ScAffiliatesView />}
    </AgentLayout>
  );
}
