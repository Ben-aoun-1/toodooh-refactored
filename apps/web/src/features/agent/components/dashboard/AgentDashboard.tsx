import { Bell, CalendarDays, Eye, KeyRound, Megaphone, Trophy, Users, Wallet } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { AgentAvatar } from '@/features/agent/components/portfolio/AgentAvatar';
import { AgentCampaignCard } from '@/features/agent/components/portfolio/AgentCampaignCard';
import { AgentCampaignDrawer } from '@/features/agent/components/portfolio/AgentCampaignDrawer';
import { CopyCode } from '@/features/agent/components/portfolio/CopyCode';
import { PayoutsDrawer } from '@/features/agent/components/portfolio/PayoutsDrawer';
import { ShCampaignDrawer } from '@/features/agent/components/portfolio/ShCampaignDrawer';
import { useAgentDashboard } from '@/features/agent/hooks/useAgentPortfolio';
import { cardModel, isShCampaign } from '@/features/agent/lib/agent-portfolio';
import { AGENT_PATHS, type AgentKind } from '@/features/agent/lib/agent-shell';
import type {
  AgentCampaign,
  ShAgentCampaign,
} from '@/features/agent/services/agent-portfolio.service';
import { formatImpressions } from '@/features/campaigns/lib/campaign-impressions';
import { formatTnd } from '@/lib/money';

import { DashboardSection } from './DashboardSection';
import { KpiCard } from './KpiCard';

const linkBtn = 'text-sm font-medium text-brand-primary hover:underline';

const COPY: Record<
  AgentKind,
  {
    affiliates: string;
    impressions: string;
    block7: string;
    all: string;
    empty7: string;
    empty8: string;
  }
> = {
  screencaster: {
    affiliates: 'Screencasters affiliés',
    impressions: 'Impressions totales générées par vos Screencasters affiliés',
    block7: 'Mes Screencasters affiliés',
    all: 'Voir tous mes Screencasters affiliés',
    empty7:
      'Vous n’avez pas encore de Screencaster affilié. Partagez votre code agent pour rattacher vos premiers annonceurs.',
    empty8:
      'Aucune campagne en cours. Les campagnes de vos Screencasters affiliés apparaîtront ici dès leur lancement.',
  },
  screenhost: {
    affiliates: 'Screenhosts affiliés',
    impressions: 'Impressions totales générées par vos Screenhosts affiliés',
    block7: 'Mes Screenhosts affiliés',
    all: 'Voir mes Screenhosts',
    empty7:
      'Vous n’avez pas encore de Screenhost affilié. Partagez votre code agent avec les lieux que vous accompagnez lors de leur inscription.',
    empty8:
      'Aucune campagne en cours. Les campagnes acceptées par vos Screenhosts affiliés apparaîtront ici.',
  },
};

/**
 * AGT-4 / AGT-7 (agent specs v1.0 §4) — the ten Dashboard blocks of either agent type, in the
 * Figma order, all from real data with an empty state each. A Screenhost with an attention point
 * carries an orange dot. Blocks 9 (rendez-vous) and 10 (notifications) come in as slots.
 */
export function AgentDashboard({
  kind,
  appointments,
  notifications,
}: {
  kind: AgentKind;
  appointments?: React.ReactNode;
  notifications?: React.ReactNode;
}) {
  const copy = COPY[kind];
  const navigate = useNavigate();
  const dash = useAgentDashboard();
  const [payoutsOpen, setPayoutsOpen] = useState(false);
  const [open, setOpen] = useState<AgentCampaign | ShAgentCampaign | null>(null);
  const d = dash.data;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => setPayoutsOpen(true)}
          className="flex min-h-[140px] flex-col justify-center rounded-2xl bg-brand-deep p-6 text-left shadow-sm"
        >
          <span className="flex items-center gap-2 text-white/80">
            <Wallet className="h-5 w-5" />
            <span className="text-sm font-medium">Revenu actuel</span>
          </span>
          <span className="mt-3 text-2xl font-bold text-white">
            {formatTnd(d?.wallet.balance_tnd ?? 0)}
            <span className="ml-1 text-base font-medium text-white/70">TND</span>
          </span>
          <span className="mt-1 text-xs text-white/60">Voir mes versements</span>
        </button>
        <div className="flex min-h-[140px] flex-col justify-center rounded-2xl bg-brand-primary p-6 shadow-sm">
          <span className="flex items-center gap-2 text-brand-deep/80">
            <KeyRound className="h-5 w-5" />
            <span className="text-sm font-medium">Code agent</span>
          </span>
          {d?.code && <CopyCode code={d.code} className="mt-3 text-2xl text-brand-deep" />}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Revenus cumulés"
          value={`${formatTnd(d?.wallet.cumulative_tnd ?? 0)} TND`}
          variationPct={d?.cumulative_variation_pct ?? null}
          icon={<Wallet className="h-5 w-5" />}
        />
        <KpiCard
          label={copy.affiliates}
          value={String(d?.affiliates_active ?? 0)}
          variationPct={d?.affiliates_variation_pct ?? null}
          icon={<Users className="h-5 w-5" />}
        />
        <KpiCard
          label={copy.impressions}
          value={formatImpressions(d?.impressions_total ?? 0)}
          variationPct={d?.impressions_variation_pct ?? null}
          icon={<Eye className="h-5 w-5" />}
        />
        <KpiCard
          label="Classement de performance Agent"
          value={d?.rank ? `${d.rank}${d.rank === 1 ? 'er' : 'e'}` : '—'}
          variationPct={null}
          icon={<Trophy className="h-5 w-5" />}
        />
      </div>

      <DashboardSection
        title={copy.block7}
        isEmpty={(d?.recent_affiliates.length ?? 0) === 0}
        empty={copy.empty7}
        emptyIcon={<Users className="h-10 w-10" />}
        action={
          <button
            type="button"
            onClick={() => navigate(AGENT_PATHS.affiliates)}
            className={linkBtn}
          >
            {copy.all}
          </button>
        }
      >
        <div className="flex flex-wrap gap-3">
          {d?.recent_affiliates.map((a) => (
            <span key={a.id} className="relative">
              <AgentAvatar name={a.name} size="lg" />
              {a.attention > 0 && (
                <span
                  title="Point d’attention"
                  className="absolute -right-0.5 -top-0.5 h-3.5 w-3.5 rounded-full bg-orange-500 ring-2 ring-white"
                />
              )}
            </span>
          ))}
        </div>
      </DashboardSection>

      <DashboardSection
        title="Mes campagnes affiliées en cours"
        isEmpty={(d?.current_campaigns.length ?? 0) === 0}
        empty={copy.empty8}
        emptyIcon={<Megaphone className="h-10 w-10" />}
        action={
          <button type="button" onClick={() => navigate(AGENT_PATHS.campaigns)} className={linkBtn}>
            Voir mes campagnes
          </button>
        }
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {d?.current_campaigns.map((c) => (
            <AgentCampaignCard key={c.id} campaign={cardModel(c)} onOpen={() => setOpen(c)} />
          ))}
        </div>
      </DashboardSection>

      {appointments ?? (
        <DashboardSection
          title="Mes rendez-vous"
          isEmpty
          empty="Aucun rendez-vous à venir."
          emptyIcon={<CalendarDays className="h-10 w-10" />}
          action={
            <button
              type="button"
              onClick={() => navigate(AGENT_PATHS.calendar)}
              className={linkBtn}
            >
              Accéder au calendrier
            </button>
          }
        />
      )}
      {notifications ?? (
        <DashboardSection
          title="Notifications"
          isEmpty
          empty="Aucune notification pour le moment."
          emptyIcon={<Bell className="h-10 w-10" />}
        />
      )}

      <PayoutsDrawer open={payoutsOpen} onClose={() => setPayoutsOpen(false)} />
      {open && isShCampaign(open) ? (
        <ShCampaignDrawer campaign={open} onClose={() => setOpen(null)} />
      ) : (
        <AgentCampaignDrawer campaign={open} onClose={() => setOpen(null)} />
      )}
    </div>
  );
}
