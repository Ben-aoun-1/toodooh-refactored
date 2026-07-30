import { Check, MonitorPlay, Play, X } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'react-hot-toast';

import PageHeader from '@/components/PageHeader';
import { useAuthStore } from '@/features/auth/stores/auth.store';
import AllocationSpotViewer from '@/features/screenhost/components/AllocationSpotViewer';
import EventAllocationCard from '@/features/screenhost/components/EventAllocationCard';
import OwnerNavigation from '@/features/screenhost/components/OwnerNavigation';
import OwnerNotificationsBell from '@/features/screenhost/components/OwnerNotificationsBell';
import { useScreenhostAllocations } from '@/features/screenhost/hooks/useScreenhostAllocations';
import { useScreenhostEventAllocations } from '@/features/screenhost/hooks/useScreenhostEventAllocations';
import {
  ACCEPT_ALLOCATION_REMINDER,
  REFUSED_STATE_DETAIL,
  REFUSED_STATE_LABEL,
  REJECT_ALLOCATION_CONFIRM,
  type PendingAllocation,
  campaignTypeLabel,
  categoriesLabel,
  decisionNeedsConfirm,
  displayAllocations,
  revenueLabel,
  zonesLabel,
} from '@/features/screenhost/services/screenhost-allocations.service';
import { EVENT_REFUSE_CONFIRM } from '@/features/screenhost/services/screenhost-event-allocations.service';

/**
 * Owner accept/reject surface — the de-Supabased replacement for the legacy per-campaign
 * `campaign_owner_approvals` flow. Lists the owner's EN_ATTENTE dispatch allocations (one per
 * allocated screenhost) from `GET /api/screenhosts/allocations`; Accept (→ ACCEPTE, the campaign
 * may now air on that venue) / Reject (→ REFUSE, it stays off-air) call the owner-scoped POST
 * endpoints. The notification bell links here.
 *
 * CF-O1 (spec §2.2) — each card shows the FULL proposal: type, catégories, période, zones, and the
 * spot itself via « Voir le spot » (lazy presign on expand). Accept confirms with the
 * keep-screens-active reminder; a confirmed refusal flips the card to « Refus enregistré »
 * (session-held — the card stays visible instead of vanishing from the EN_ATTENTE refetch).
 */
const fmtDate = (iso: string | null): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('fr-FR');
};

export default function OwnerAllocations() {
  const { user, needsApproval, validationStatus } = useAuthStore();
  const isDisabled = needsApproval && validationStatus === 'pending';

  const { allocations, loading, isError, accept, reject, deciding } = useScreenhostAllocations(
    user?.id,
  );
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [refusedById, setRefusedById] = useState<ReadonlyMap<string, PendingAllocation>>(new Map());

  // EV4 — the EVENT proposals (§11.1), a SIBLING list above the campaigns: the accept reminder
  // comes from the API's response; a confirmed refusal holds its card in « Refus enregistré »
  // (the campaign idiom, kept). Nothing here airs before EV5.
  const eventProposals = useScreenhostEventAllocations(user?.id);
  const [refusedEventIds, setRefusedEventIds] = useState<ReadonlySet<string>>(new Set());
  const decideEvent = async (id: string, kind: 'accept' | 'refuse') => {
    if (kind === 'refuse' && !window.confirm(EVENT_REFUSE_CONFIRM)) return;
    setPendingId(id);
    try {
      if (kind === 'accept') {
        const reminder = await eventProposals.accept(id);
        toast.success(reminder ?? 'Événement accepté.');
      } else {
        await eventProposals.refuse(id);
        setRefusedEventIds((prev) => new Set(prev).add(id));
      }
    } catch {
      toast.error(
        kind === 'accept'
          ? 'Impossible d’accepter l’événement'
          : 'Impossible de refuser l’événement',
      );
    } finally {
      setPendingId(null);
    }
  };

  const decide = async (allocation: PendingAllocation, kind: 'accept' | 'reject') => {
    // CF-Q1 — refusal is consequential and irreversible: confirm first, matching the app's
    // window.confirm idiom (MyCampaigns draft deletion). Accept stays one-click.
    if (decisionNeedsConfirm(kind) && !window.confirm(REJECT_ALLOCATION_CONFIRM)) return;
    setPendingId(allocation.id);
    try {
      if (kind === 'accept') {
        await accept(allocation.id);
        toast.success(ACCEPT_ALLOCATION_REMINDER);
      } else {
        await reject(allocation.id);
        // No toast — the card's « Refus enregistré » state IS the feedback (spec §2.2).
        setRefusedById((prev) => new Map(prev).set(allocation.id, allocation));
      }
    } catch {
      toast.error(
        kind === 'accept'
          ? 'Impossible d’accepter la campagne'
          : 'Impossible de refuser la campagne',
      );
    } finally {
      setPendingId(null);
    }
  };

  const shown = displayAllocations(allocations, refusedById);

  return (
    <div className="min-h-screen bg-white">
      <div className="flex h-screen">
        <OwnerNavigation isDisabled={isDisabled} />

        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          <header className="bg-white border-b border-[#EBEBEB]">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3">
              <div className="flex items-center justify-between gap-3">
                <PageHeader
                  title="Campagnes à valider"
                  subtitle="Acceptez ou refusez la diffusion sur vos écrans"
                />
                <OwnerNotificationsBell userId={user?.id} />
              </div>
            </div>
          </header>

          <div className="flex-1 overflow-y-auto">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
              {/* EV4 — ÉVÉNEMENTS: the owner's pending event proposals, above the campaigns. */}
              {eventProposals.proposals.length > 0 && (
                <div className="mb-6">
                  <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-gray-500">
                    Événements
                  </h2>
                  <ul className="space-y-3">
                    {eventProposals.proposals.map((proposal) => (
                      <EventAllocationCard
                        key={proposal.id}
                        proposal={proposal}
                        refused={refusedEventIds.has(proposal.id)}
                        busy={eventProposals.deciding && pendingId === proposal.id}
                        onAccept={() => void decideEvent(proposal.id, 'accept')}
                        onRefuse={() => void decideEvent(proposal.id, 'refuse')}
                      />
                    ))}
                  </ul>
                </div>
              )}
              {loading ? (
                <div className="py-16 text-center text-sm text-gray-500">Chargement...</div>
              ) : isError ? (
                <div className="py-16 text-center text-sm text-[#FB3748]">
                  Impossible de charger les campagnes à valider.
                </div>
              ) : shown.length === 0 ? (
                <div className="py-16 text-center text-sm text-gray-500">
                  Aucune campagne en attente de votre validation.
                </div>
              ) : (
                <ul className="space-y-3">
                  {shown.map(({ allocation: a, refused }) => {
                    const busy = deciding && pendingId === a.id;
                    const expanded = expandedId === a.id;
                    return (
                      <li
                        key={a.id}
                        className="rounded-2xl border border-[#EBEBEB] bg-white px-5 py-4"
                      >
                        <div className="flex items-center justify-between gap-4">
                          <div className="flex items-start gap-3 min-w-0">
                            <div className="mt-0.5 h-10 w-10 rounded-full border border-brand-primary text-[#2A7A47] flex items-center justify-center flex-shrink-0">
                              <MonitorPlay className="h-4 w-4" />
                            </div>
                            <div className="min-w-0">
                              {/* CF-Q1 (spec 2.2 « en tête le montant qui me revient ») — the owner's
                                  money leads the card; the API always returns revenu_previsionnel. */}
                              <p className="text-sm font-semibold text-[#2A7A47]">
                                Revenu estimé sur la période : {revenueLabel(a.revenu_previsionnel)}
                              </p>
                              <p className="text-base font-medium text-[#171717] truncate">
                                {a.campaign_name}
                              </p>
                              <p className="text-sm text-[#5C5C5C] truncate">{a.screenhost_name}</p>
                              <p className="text-xs text-[#7A7A7A] mt-0.5">
                                Du {fmtDate(a.start_date)} au {fmtDate(a.end_date)} ·{' '}
                                {a.ii_potentiel.toLocaleString('fr-FR')} impressions · {a.r_i}{' '}
                                diff./h
                              </p>
                              {/* CF-O1 — the rest of the proposal: type, catégories, zones. */}
                              <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-[#5C5C5C]">
                                <span>
                                  <span className="text-[#7A7A7A]">Type : </span>
                                  {campaignTypeLabel(a.campaign_type)}
                                </span>
                                <span>
                                  <span className="text-[#7A7A7A]">Catégories : </span>
                                  {categoriesLabel(a.categories)}
                                </span>
                                <span>
                                  <span className="text-[#7A7A7A]">Zones : </span>
                                  {zonesLabel(a.zones)}
                                </span>
                              </div>
                              {a.creative && (
                                <button
                                  type="button"
                                  onClick={() => setExpandedId(expanded ? null : a.id)}
                                  className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-brand-deep hover:underline"
                                >
                                  <Play className="h-3.5 w-3.5" />
                                  {expanded ? 'Masquer le spot' : 'Voir le spot'}
                                </button>
                              )}
                            </div>
                          </div>
                          {refused ? (
                            <div className="flex flex-col items-end gap-1 flex-shrink-0 text-right">
                              <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-3 py-1.5 text-sm font-medium text-[#5C5C5C]">
                                <X className="h-4 w-4" />
                                {REFUSED_STATE_LABEL}
                              </span>
                              <span className="text-xs text-[#7A7A7A]">{REFUSED_STATE_DETAIL}</span>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2 flex-shrink-0">
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => void decide(a, 'reject')}
                                className="h-10 px-4 rounded-xl border border-gray-200 bg-white text-sm font-medium text-[#5C5C5C] hover:bg-gray-50 disabled:opacity-50 inline-flex items-center gap-2"
                              >
                                <X className="h-4 w-4" />
                                Refuser
                              </button>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => void decide(a, 'accept')}
                                className="h-10 px-4 rounded-xl bg-brand-primary text-sm font-semibold text-[#101010] hover:bg-brand-primary/90 disabled:opacity-50 inline-flex items-center gap-2"
                              >
                                <Check className="h-4 w-4" />
                                Accepter
                              </button>
                            </div>
                          )}
                        </div>
                        {/* CF-O1 — the spot viewer, mounted only while expanded (lazy presign). */}
                        {expanded && a.creative && (
                          <div className="mt-3 pl-[3.25rem]">
                            <AllocationSpotViewer allocation={a} />
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
