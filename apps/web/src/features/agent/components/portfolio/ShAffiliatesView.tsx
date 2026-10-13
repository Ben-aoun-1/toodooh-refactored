import { Loader2, Users } from 'lucide-react';
import { useState } from 'react';

import { useAgentAccount } from '@/features/agent/hooks/useAgentAccount';
import { useShAgentAffiliates } from '@/features/agent/hooks/useAgentPortfolio';
import { affiliationEnded, frDate } from '@/features/agent/lib/agent-portfolio';
import type { ShAffiliate } from '@/features/agent/services/agent-portfolio.service';
import { useAgentViewStore, viewOf } from '@/features/agent/stores/agent-view.store';
import { useAuthStore } from '@/features/auth/stores/auth.store';
import { formatImpressions } from '@/features/campaigns/lib/campaign-impressions';
import { tndLabel } from '@/lib/money';

import { AgentAvatar } from './AgentAvatar';
import { CopyCode } from './CopyCode';
import { FollowupPanel } from './FollowupPanel';
import { ShVenueSheet } from './ShVenueSheet';
import { ViewToggle } from './ViewToggle';

const EMPTY =
  'Vous n’avez pas encore de Screenhost affilié. Partagez votre code agent avec les lieux que vous accompagnez lors de leur inscription.';

const since = (a: ShAffiliate) => (a.start_date ? frDate(a.start_date) : 'En attente d’activation');

/**
 * AGT-7 (Agent Screenhost spec v1.0 §6) — the portfolio on the left (cards or table remembered
 * per agent), « Suivi de mes Screenhosts » on the right (below on narrow screens). A click on a
 * venue in either zone opens its sheet. « Revenus générés » is always the agent's commission.
 */
export function ShAffiliatesView() {
  const userId = useAuthStore((s) => s.user?.id);
  const views = useAgentViewStore((s) => s.views);
  const setView = useAgentViewStore((s) => s.setView);
  const view = viewOf(views, userId, 'affiliates');
  const query = useShAgentAffiliates();
  const account = useAgentAccount();
  const [open, setOpen] = useState<string | null>(null);
  const rows = query.data?.affiliates ?? [];

  const badges = (a: ShAffiliate) => (
    <span className="flex flex-wrap gap-1">
      {affiliationEnded(a) && (
        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
          Affiliation terminée
        </span>
      )}
      {a.exploited_by_agent && (
        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
          Exploité par vous
        </span>
      )}
      {a.attention.length > 0 && (
        <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs text-orange-700">
          {a.attention.length} point{a.attention.length > 1 ? 's' : ''} d’attention
        </span>
      )}
    </span>
  );

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_480px]">
      <div className="space-y-4">
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
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {rows.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => setOpen(a.screenhost_id)}
                className="flex flex-col gap-3 rounded-xl border border-[#E1E4EA] bg-white p-4 text-left hover:border-brand-primary"
              >
                <div className="flex items-center gap-3">
                  <AgentAvatar name={a.name} />
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{a.name}</p>
                    <p className="text-xs text-gray-500">
                      {since(a)}
                      {a.end_date ? ` → ${frDate(a.end_date)}` : ''}
                    </p>
                  </div>
                </div>
                {badges(a)}
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
                  <th className="px-4 py-3">Nom du Screenhost</th>
                  <th className="px-4 py-3">Date d’affiliation</th>
                  <th className="px-4 py-3">Fin d’affiliation</th>
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
                        onClick={() => setOpen(a.screenhost_id)}
                        className="flex items-center gap-2 font-medium hover:text-brand-primary"
                      >
                        <AgentAvatar name={a.name} size="sm" />
                        {a.name}
                      </button>
                      {badges(a)}
                    </td>
                    <td className="px-4 py-3">{since(a)}</td>
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
      <FollowupPanel onOpen={setOpen} />
      <ShVenueSheet screenhostId={open} onClose={() => setOpen(null)} />
    </div>
  );
}
