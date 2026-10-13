import { Loader2, Megaphone, MoreVertical, Search } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import AgentLayout from '@/features/agent/components/AgentLayout';
import { AgentAvatar } from '@/features/agent/components/portfolio/AgentAvatar';
import { AgentCampaignCard } from '@/features/agent/components/portfolio/AgentCampaignCard';
import { AgentCampaignDrawer } from '@/features/agent/components/portfolio/AgentCampaignDrawer';
import { CampaignStatusBadge } from '@/features/agent/components/portfolio/CampaignStatusBadge';
import { ShCampaignsView } from '@/features/agent/components/portfolio/ShCampaignsView';
import { ViewToggle } from '@/features/agent/components/portfolio/ViewToggle';
import { useAgentCampaigns } from '@/features/agent/hooks/useAgentPortfolio';
import {
  type CampaignTab,
  campaignCounters,
  cardModel,
  filterCampaigns,
  frDate,
} from '@/features/agent/lib/agent-portfolio';
import { agentKindOf } from '@/features/agent/lib/agent-shell';
import type { AgentCampaign } from '@/features/agent/services/agent-portfolio.service';
import { useAgentViewStore, viewOf } from '@/features/agent/stores/agent-view.store';
import { useAuthStore } from '@/features/auth/stores/auth.store';
import { formatImpressions } from '@/features/campaigns/lib/campaign-impressions';
import { tndLabel } from '@/lib/money';

const TABS: [CampaignTab, string][] = [
  ['all', 'Tous'],
  ['active', 'Actives'],
  ['a_venir', 'À venir'],
  ['terminee', 'Terminées'],
];

const EMPTY =
  'Aucune campagne pour le moment. Les campagnes de vos Screencasters affiliés apparaîtront ici dès leur lancement.';

/**
 * AGT-4 (Agent Screencaster spec v1.0 §5) — « Mes campagnes affiliées », read-only: counters,
 * tabs, search on campaign or Screencaster, cards (default) or table remembered per agent, and
 * the detail drawer. `?affilie=<id>` narrows the list to one Screencaster (from Mes Screencasters).
 */
function ScCampaignsView() {
  const userId = useAuthStore((s) => s.user?.id);
  const views = useAgentViewStore((s) => s.views);
  const setView = useAgentViewStore((s) => s.setView);
  const view = viewOf(views, userId, 'campaigns');
  const [params, setParams] = useSearchParams();
  const affiliateId = params.get('affilie');
  const [tab, setTab] = useState<CampaignTab>('all');
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<AgentCampaign | null>(null);
  const query = useAgentCampaigns();
  const all = query.data?.campaigns ?? [];
  const counters = campaignCounters(all);
  const rows = filterCampaigns(all, tab, search, affiliateId);
  const affiliateName = affiliateId
    ? all.find((c) => c.affiliate_id === affiliateId)?.affiliate_name
    : null;

  return (
    <>
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {(
            [
              ['Total campagnes', counters.total],
              ['Actives', counters.active],
              ['À venir', counters.a_venir],
              ['Terminées', counters.terminee],
            ] as const
          ).map(([label, n]) => (
            <div key={label} className="rounded-xl border border-[#E1E4EA] bg-white p-4">
              <p className="text-sm text-gray-500">{label}</p>
              <p className="mt-1 text-2xl font-bold tabular-nums">{n}</p>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-1 rounded-lg bg-gray-100 p-1">
            {TABS.map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={`rounded-md px-3 py-1.5 text-sm ${tab === key ? 'bg-white font-semibold shadow-sm' : 'text-gray-600'}`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <label className="relative">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Rechercher"
                aria-label="Rechercher une campagne ou un Screencaster"
                className="w-56 rounded-lg border border-[#E1E4EA] py-2 pl-9 pr-3 text-sm"
              />
            </label>
            <ViewToggle view={view} onChange={(v) => setView(userId ?? '', 'campaigns', v)} />
          </div>
        </div>

        {affiliateName && (
          <p className="text-sm text-gray-600">
            Campagnes de <span className="font-medium">{affiliateName}</span> —{' '}
            <button type="button" onClick={() => setParams({})} className="text-brand-primary">
              voir toutes
            </button>
          </p>
        )}

        {query.isLoading ? (
          <Loader2 className="mx-auto my-10 h-6 w-6 animate-spin text-brand-primary" />
        ) : rows.length === 0 ? (
          <div className="rounded-2xl border border-[#E1E4EA] bg-white px-6 py-12 text-center">
            <Megaphone className="mx-auto mb-3 h-10 w-10 text-gray-300" />
            <p className="text-sm text-gray-600">{EMPTY}</p>
          </div>
        ) : view === 'cards' ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {rows.map((c) => (
              <AgentCampaignCard key={c.id} campaign={cardModel(c)} onOpen={() => setOpen(c)} />
            ))}
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-[#E1E4EA] bg-white">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-4 py-3">Nom de la campagne</th>
                  <th className="px-4 py-3">Screencaster</th>
                  <th className="px-4 py-3">Statut</th>
                  <th className="px-4 py-3">Date de début</th>
                  <th className="px-4 py-3">Date de fin</th>
                  <th className="px-4 py-3">Revenu</th>
                  <th className="px-4 py-3">Impressions</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((c) => (
                  <tr key={c.id}>
                    <td className="px-4 py-3 font-medium">{c.name}</td>
                    <td className="px-4 py-3">
                      <span className="flex items-center gap-2">
                        <AgentAvatar name={c.affiliate_name} size="sm" />
                        {c.affiliate_name}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <CampaignStatusBadge status={c.status} />
                    </td>
                    <td className="px-4 py-3">{frDate(c.start_date)}</td>
                    <td className="px-4 py-3">{frDate(c.end_date)}</td>
                    <td className="px-4 py-3">{tndLabel(c.revenue_tnd)}</td>
                    <td className="px-4 py-3">{formatImpressions(c.impressions)}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => setOpen(c)}
                        aria-label="Voir le détail"
                        title="Voir le détail"
                        className="rounded p-1 text-gray-500 hover:bg-gray-100"
                      >
                        <MoreVertical className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <AgentCampaignDrawer campaign={open} onClose={() => setOpen(null)} />
    </>
  );
}

/** AGT-4 / AGT-7 — « Mes campagnes affiliées » of the agent's type. */
export default function AgentCampaigns() {
  const role = useAuthStore((s) => s.role);
  return (
    <AgentLayout page="campaigns">
      {agentKindOf(role) === 'screenhost' ? <ShCampaignsView /> : <ScCampaignsView />}
    </AgentLayout>
  );
}
