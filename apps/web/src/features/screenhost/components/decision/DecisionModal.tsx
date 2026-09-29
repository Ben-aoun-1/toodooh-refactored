import { useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { useCallback, useState } from 'react';
import { toast } from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';

import { useAuthStore } from '@/features/auth/stores/auth.store';
import { campaignsKeys } from '@/features/campaigns/hooks/queryKeys';
import CampaignDecisionDetails from '@/features/screenhost/components/decision/CampaignDecisionDetails';
import CenteredOverlay from '@/features/screenhost/components/decision/CenteredOverlay';
import DecisionOutcomeCard from '@/features/screenhost/components/decision/DecisionOutcomeCard';
import EventDecisionDetails from '@/features/screenhost/components/decision/EventDecisionDetails';
import RefuseConfirmDialog from '@/features/screenhost/components/decision/RefuseConfirmDialog';
import { screenhostKeys } from '@/features/screenhost/hooks/queryKeys';
import { useOwnerCampaigns } from '@/features/screenhost/hooks/useOwnerCampaigns';
import { useScreenhostAllocations } from '@/features/screenhost/hooks/useScreenhostAllocations';
import { useScreenhostEventAllocations } from '@/features/screenhost/hooks/useScreenhostEventAllocations';
import {
  type DecisionOutcome,
  decisionTarget,
} from '@/features/screenhost/lib/decision-notifications';
import { statusUi } from '@/features/screenhost/lib/owner-campaigns.lib';

type Stage = 'details' | 'confirm-refuse' | DecisionOutcome;

/**
 * NOTIF-D1 — « Consulter » on an accept/refuse notification opens THIS popup instead of leaving
 * the page (Figma « notif accepter refuser », frames 588–591). Pending → Refuser / Accepter;
 * already decided → Fermer. Every layer is centered in the viewport.
 */
export default function DecisionModal({
  campaignId,
  onClose,
}: {
  campaignId: string;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const userId = useAuthStore((s) => s.user?.id);
  const campaigns = useOwnerCampaigns(userId);
  const events = useScreenhostEventAllocations(userId);
  const allocations = useScreenhostAllocations(userId);
  const [stage, setStage] = useState<Stage>('details');
  const [busy, setBusy] = useState(false);
  // Frozen at decision time: the accept refetch drops the proposal from the pending lists, so the
  // live target would stop reading as an event before the outcome card renders.
  const [decidedKind, setDecidedKind] = useState<'campaign' | 'event'>('campaign');

  const loading = campaigns.loading || events.loading;
  const target = decisionTarget(campaignId, events.proposals, campaigns.data ?? []);
  const targetKind = target.kind === 'event' ? 'event' : 'campaign';
  const pending =
    target.kind === 'event' || (target.kind === 'campaign' && target.pendingIds.length > 0);

  // The refusal path deliberately skips the pending-list invalidation (the allocations page keeps
  // its « Refus enregistré » card); the popup is not that page, so it refreshes every owner read
  // the decision moves — including the bell's history bucketing.
  const refreshAll = useCallback(() => {
    const id = userId ?? '';
    for (const queryKey of [
      screenhostKeys.pendingAllocations(id),
      screenhostKeys.campaigns(id),
      screenhostKeys.notifications(id),
      campaignsKeys.ownerApprovals(id),
    ]) {
      void queryClient.invalidateQueries({ queryKey });
    }
  }, [queryClient, userId]);

  const decide = async (kind: 'accept' | 'refuse') => {
    setBusy(true);
    setDecidedKind(targetKind);
    try {
      if (target.kind === 'event') {
        for (const p of target.proposals) {
          if (kind === 'accept') await events.accept(p.id);
          else await events.refuse(p.id);
        }
      } else if (target.kind === 'campaign') {
        for (const id of target.pendingIds) {
          if (kind === 'accept') await allocations.accept(id);
          else await allocations.reject(id);
        }
      }
      setStage(kind === 'accept' ? 'accepted' : 'refused');
    } catch {
      toast.error(
        kind === 'accept' ? 'Impossible d’accepter la proposition' : 'Impossible de refuser',
      );
      setStage('details');
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    if (stage === 'accepted' || stage === 'refused') refreshAll();
    onClose();
  };

  if (stage === 'accepted' || stage === 'refused') {
    return (
      <CenteredOverlay onDismiss={close} labelledBy="decision-outcome-title">
        <DecisionOutcomeCard
          outcome={stage}
          target={decidedKind}
          onDashboard={() => {
            close();
            navigate('/owner-dashboard');
          }}
        />
      </CenteredOverlay>
    );
  }

  const title =
    target.kind === 'event'
      ? (target.proposals[0]?.match_name ?? '')
      : target.kind === 'campaign'
        ? target.campaign.name
        : '';
  const pill = statusUi(
    pending ? 'pending' : target.kind === 'campaign' ? target.campaign.status : 'pending',
  );

  return (
    <>
      <CenteredOverlay onDismiss={close} labelledBy="decision-modal-title">
        <div className="flex max-h-[calc(100vh-2rem)] w-full max-w-[440px] flex-col rounded-2xl bg-white shadow-xl">
          <header className="flex items-start gap-3 border-b border-[#EBEBEB] p-4">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <h2 id="decision-modal-title" className="truncate text-lg font-medium text-[#171717]">
                {loading ? 'Chargement…' : title || 'Proposition'}
              </h2>
              {!loading && target.kind !== 'missing' && (
                <span
                  className={`inline-flex w-fit items-center rounded-md px-1.5 py-0.5 text-xs font-medium ${pill.badge}`}
                >
                  <span className={`mr-1.5 h-1.5 w-1.5 rounded-full ${pill.dot}`} />
                  {pill.label}
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={close}
              className="rounded-lg p-2 text-[#5C5C5C] hover:bg-gray-100"
              aria-label="Fermer"
            >
              <X className="h-5 w-5" strokeWidth={1.5} />
            </button>
          </header>

          <div className="flex-1 space-y-4 overflow-y-auto p-4">
            {loading ? (
              <div className="py-10 text-center text-sm text-[#A3A3A3]">Chargement…</div>
            ) : target.kind === 'event' ? (
              <EventDecisionDetails proposals={target.proposals} />
            ) : target.kind === 'campaign' ? (
              <CampaignDecisionDetails campaign={target.campaign} />
            ) : (
              <p className="py-10 text-center text-sm text-[#5C5C5C]">
                Cette proposition a déjà été traitée.
              </p>
            )}
          </div>

          <footer className="flex gap-3 border-t border-[#EBEBEB] p-4">
            {pending && !loading ? (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setStage('confirm-refuse')}
                  className="h-10 flex-1 rounded-lg border border-[#FFC0C5] bg-[#FFEBEC] text-sm font-medium text-[#FB3748] hover:bg-[#FFE0E3] disabled:opacity-60"
                >
                  Refuser
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void decide('accept')}
                  className="h-10 flex-1 rounded-lg border border-brand-primary bg-[#E8F8EE] text-sm font-medium text-[#1FC16B] hover:bg-[#DCF5E6] disabled:opacity-60"
                >
                  Accepter
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={close}
                className="h-10 flex-1 rounded-lg border border-[#EBEBEB] bg-white text-sm text-[#5C5C5C] hover:bg-gray-50"
              >
                Fermer
              </button>
            )}
          </footer>
        </div>
      </CenteredOverlay>

      {stage === 'confirm-refuse' && (
        <RefuseConfirmDialog
          target={targetKind}
          busy={busy}
          onCancel={() => setStage('details')}
          onConfirm={() => void decide('refuse')}
        />
      )}
    </>
  );
}
