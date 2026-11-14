import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { useAgentCampaigns, useShAgentCampaigns } from '@/features/agent/hooks/useAgentPortfolio';
import { vfNum, vfTnd } from '@/features/agent/lib/agent-format';
import {
  type CampaignTab,
  campaignCounters,
  filterCampaigns,
  filterShCampaigns,
} from '@/features/agent/lib/agent-portfolio';
import type { AgentKind } from '@/features/agent/lib/agent-shell';
import { isShAgentCampaign, vfCampCard, vfDate } from '@/features/agent/lib/agent-vf';
import type {
  AgentCampaign,
  ShAgentCampaign,
} from '@/features/agent/services/agent-portfolio.service';
import { useAgentViewStore, viewOf } from '@/features/agent/stores/agent-view.store';
import { useAuthStore } from '@/features/auth/stores/auth.store';

import { VfCampCard, VfStatusBadge } from './VfCampCard';
import { VfCampWindow } from './VfCampWindow';
import { VfEmpty } from './VfEmpty';
import { VfIcon } from './VfIcon';
import { useVfOverlay } from './VfOverlay';

const TABS: [CampaignTab, string][] = [
  ['all', 'Tous'],
  ['active', 'Actives'],
  ['a_venir', 'À venir'],
  ['terminee', 'Terminées'],
];

const COPY: Record<AgentKind, { search: string; empty: string }> = {
  screencaster: {
    search: 'Rechercher une campagne ou un Screencaster',
    empty:
      'Aucune campagne pour le moment. Les campagnes de vos Screencasters affiliés apparaîtront ici dès leur lancement.',
  },
  screenhost: {
    search: 'Rechercher une campagne, un annonceur, un Screenhost',
    empty:
      'Aucune campagne pour le moment. Les campagnes acceptées par vos Screenhosts affiliés apparaîtront ici.',
  },
};

/**
 * AGENT-VF (spec VF « Mes campagnes ») — the affiliated campaigns: four counters, tabs, search,
 * cards (default) or table (the choice is remembered per agent), and the detail in the window at
 * the centre. `?affilie=<id>` narrows the list to one affiliate (« Voir ses campagnes »).
 */
export function VfCampaigns({ kind }: { kind: AgentKind }) {
  const sh = kind === 'screenhost';
  const copy = COPY[kind];
  const { openBig } = useVfOverlay();
  const userId = useAuthStore((s) => s.user?.id);
  const views = useAgentViewStore((s) => s.views);
  const setView = useAgentViewStore((s) => s.setView);
  const view = viewOf(views, userId, 'campaigns');
  const [params, setParams] = useSearchParams();
  const affiliateId = params.get('affilie');
  const [tab, setTab] = useState<CampaignTab>('all');
  const [search, setSearch] = useState('');
  const scQuery = useAgentCampaigns();
  const shQuery = useShAgentCampaigns();

  const all: (AgentCampaign | ShAgentCampaign)[] = sh
    ? (shQuery.data?.campaigns ?? [])
    : (scQuery.data?.campaigns ?? []);
  const rows: (AgentCampaign | ShAgentCampaign)[] = sh
    ? filterShCampaigns(shQuery.data?.campaigns ?? [], tab, search, affiliateId)
    : filterCampaigns(scQuery.data?.campaigns ?? [], tab, search, affiliateId);
  const counters = campaignCounters(all);
  const filterName = affiliateId
    ? all
        .map((c) =>
          isShAgentCampaign(c)
            ? c.venues.find((v) => v.id === affiliateId)?.name
            : c.affiliate_id === affiliateId
              ? c.affiliate_name
              : undefined,
        )
        .find(Boolean)
    : null;
  const open = (c: AgentCampaign | ShAgentCampaign) => openBig(<VfCampWindow campaign={c} />);

  return (
    <>
      <div className="grid4">
        {(
          [
            ['Total campagnes', counters.total],
            ['Actives', counters.active],
            ['À venir', counters.a_venir],
            ['Terminées', counters.terminee],
          ] as const
        ).map(([label, value]) => (
          <div className="kpi" key={label}>
            <small>{label}</small>
            <b>{vfNum(value)}</b>
          </div>
        ))}
      </div>
      <div className="toolbar">
        <div className="tabs">
          {TABS.map(([key, label]) => (
            <button
              type="button"
              key={key}
              className={tab === key ? 'on' : undefined}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </div>
        {affiliateId && (
          <button
            type="button"
            className="tag vf-filter"
            title="Retirer le filtre"
            onClick={() => setParams({})}
          >
            {filterName ?? 'Filtre'} ✕
          </button>
        )}
        <span className="sp" />
        <label className="search">
          <VfIcon k="search" size={15} />
          <input
            placeholder={copy.search}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <div className="vt">
          <button
            type="button"
            aria-label="Vue cartes"
            className={view === 'cards' ? 'on' : undefined}
            onClick={() => userId && setView(userId, 'campaigns', 'cards')}
          >
            <VfIcon k="dash" size={15} />
          </button>
          <button
            type="button"
            aria-label="Vue tableau"
            className={view === 'table' ? 'on' : undefined}
            onClick={() => userId && setView(userId, 'campaigns', 'table')}
          >
            ≡
          </button>
        </div>
      </div>
      {rows.length === 0 ? (
        <div className="card">
          <VfEmpty icon="camp" text={copy.empty} />
        </div>
      ) : view === 'cards' ? (
        <div className="camps">
          {rows.map((c) => (
            <VfCampCard key={c.id} campaign={vfCampCard(c)} onOpen={() => open(c)} />
          ))}
        </div>
      ) : (
        <div className="card vf-scroll">
          <table>
            <tbody>
              <tr>
                <th>Campagne</th>
                <th>{sh ? 'Annonceur' : 'Screencaster'}</th>
                {sh && <th>Screenhosts touchés</th>}
                <th>Statut</th>
                <th>Début</th>
                <th>Fin</th>
                <th>Revenu</th>
                <th>À gagner</th>
                <th>Impressions</th>
              </tr>
              {rows.map((c) => (
                <tr className="cl" key={c.id} onClick={() => open(c)}>
                  <td>
                    <b>{c.name}</b>
                  </td>
                  <td>{isShAgentCampaign(c) ? c.advertiser_name : c.affiliate_name}</td>
                  {isShAgentCampaign(c) && <td>{c.venues_touched}</td>}
                  <td>
                    <VfStatusBadge status={c.status} />
                  </td>
                  <td>{vfDate(c.start_date)}</td>
                  <td>{vfDate(c.end_date)}</td>
                  <td>{vfTnd(c.revenue_tnd)}</td>
                  <td className="vf-gain">
                    {c.status === 'terminee' ? '–' : vfTnd(c.to_earn_tnd)}
                  </td>
                  <td>{vfNum(c.impressions)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
