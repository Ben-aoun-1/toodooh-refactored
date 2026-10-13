import { ArrowDownRight, ArrowRight, ArrowUpRight } from 'lucide-react';
import { useState } from 'react';

import { useAgentFollowup } from '@/features/agent/hooks/useAgentPortfolio';
import { type FollowupSort, scoreLabel, sortFollowup } from '@/features/agent/lib/agent-portfolio';

import { AgentAvatar } from './AgentAvatar';

const TREND = {
  up: <ArrowUpRight className="h-4 w-4 text-emerald-600" />,
  down: <ArrowDownRight className="h-4 w-4 text-red-600" />,
  flat: <ArrowRight className="h-4 w-4 text-gray-400" />,
} as const;

/**
 * AGT-7 (Agent Screenhost spec v1.0 §6 « Suivi de mes Screenhosts ») — one row per venue pending
 * activation or affiliated; attention points first, then increasing score; sortable by column.
 */
export function FollowupPanel({ onOpen }: { onOpen: (screenhostId: string) => void }) {
  const query = useAgentFollowup();
  const [sort, setSort] = useState<FollowupSort>('default');
  const rows = sortFollowup(query.data?.rows ?? [], sort);
  const th = (key: FollowupSort, label: string) => (
    <th className="px-3 py-2">
      <button
        type="button"
        onClick={() => setSort(sort === key ? 'default' : key)}
        className={`uppercase ${sort === key ? 'text-gray-900' : ''}`}
      >
        {label}
      </button>
    </th>
  );

  return (
    <section className="rounded-2xl border border-[#E1E4EA] bg-white">
      <div className="border-b px-4 py-3">
        <h2 className="font-semibold">Suivi de mes Screenhosts</h2>
      </div>
      {rows.length === 0 ? (
        <p className="px-6 py-10 text-center text-sm text-gray-600">
          Le suivi de vos Screenhosts apparaîtra ici dès votre premier affilié.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs text-gray-500">
              <tr>
                {th('name', 'Screenhost')}
                {th('sps', 'Score')}
                {th('refused', 'Refus')}
                {th('missed', 'Passages ratés')}
                {th('attention', 'Attention')}
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r) => (
                <tr key={r.screenhost_id} className="hover:bg-gray-50">
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => onOpen(r.screenhost_id)}
                      className="flex items-center gap-2 text-left font-medium hover:text-brand-primary"
                    >
                      <AgentAvatar name={r.name} size="sm" />
                      {r.name}
                    </button>
                  </td>
                  <td className="px-3 py-2">
                    <span className="flex items-center gap-1">
                      {scoreLabel(r.sps)}
                      {r.trend && TREND[r.trend]}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    {r.refused} <span className="text-gray-500">({r.no_answer})</span>
                  </td>
                  <td className="px-3 py-2">{r.missed}</td>
                  <td className="px-3 py-2">
                    {r.attention.length > 0 && (
                      <span
                        title={r.attention.map((a) => a.label).join(' · ')}
                        className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-orange-500 px-2 text-xs font-semibold text-white"
                      >
                        {r.attention.length}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
