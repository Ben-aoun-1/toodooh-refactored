import { Check, MonitorPlay, X } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'react-hot-toast';

import { useAuthStore } from '@/features/auth/stores/auth.store';
import OwnerNavigation from '@/features/screenhost/components/OwnerNavigation';
import OwnerNotificationsBell from '@/features/screenhost/components/OwnerNotificationsBell';
import { useScreenhostAllocations } from '@/features/screenhost/hooks/useScreenhostAllocations';
import {
  REJECT_ALLOCATION_CONFIRM,
  decisionNeedsConfirm,
  revenueLabel,
} from '@/features/screenhost/services/screenhost-allocations.service';

/**
 * Owner accept/reject surface — the de-Supabased replacement for the legacy per-campaign
 * `campaign_owner_approvals` flow. Lists the owner's EN_ATTENTE dispatch allocations (one per
 * allocated screenhost) from `GET /api/screenhosts/allocations`; Accept (→ ACCEPTE, the campaign
 * may now air on that venue) / Reject (→ REFUSE, it stays off-air) call the owner-scoped POST
 * endpoints. The notification bell links here.
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

  const decide = async (id: string, kind: 'accept' | 'reject') => {
    // CF-Q1 — refusal is consequential and irreversible: confirm first, matching the app's
    // window.confirm idiom (MyCampaigns draft deletion). Accept stays one-click.
    if (decisionNeedsConfirm(kind) && !window.confirm(REJECT_ALLOCATION_CONFIRM)) return;
    setPendingId(id);
    try {
      if (kind === 'accept') {
        await accept(id);
        toast.success('Campagne acceptée');
      } else {
        await reject(id);
        toast.success('Campagne refusée');
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

  return (
    <div className="min-h-screen bg-white">
      <div className="flex h-screen">
        <OwnerNavigation isDisabled={isDisabled} />

        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          <header className="bg-white border-b border-[#EBEBEB]">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h1 className="text-xl font-semibold text-[#171717]">Campagnes à valider</h1>
                  <p className="text-sm text-[#5C5C5C]">
                    Acceptez ou refusez la diffusion sur vos écrans
                  </p>
                </div>
                <OwnerNotificationsBell userId={user?.id} />
              </div>
            </div>
          </header>

          <div className="flex-1 overflow-y-auto">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
              {loading ? (
                <div className="py-16 text-center text-sm text-gray-500">Chargement...</div>
              ) : isError ? (
                <div className="py-16 text-center text-sm text-[#FB3748]">
                  Impossible de charger les campagnes à valider.
                </div>
              ) : allocations.length === 0 ? (
                <div className="py-16 text-center text-sm text-gray-500">
                  Aucune campagne en attente de votre validation.
                </div>
              ) : (
                <ul className="space-y-3">
                  {allocations.map((a) => {
                    const busy = deciding && pendingId === a.id;
                    return (
                      <li
                        key={a.id}
                        className="rounded-2xl border border-[#EBEBEB] bg-white px-5 py-4 flex items-center justify-between gap-4"
                      >
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
                              {a.ii_potentiel.toLocaleString('fr-FR')} impressions · {a.r_i} diff./h
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void decide(a.id, 'reject')}
                            className="h-10 px-4 rounded-xl border border-gray-200 bg-white text-sm font-medium text-[#5C5C5C] hover:bg-gray-50 disabled:opacity-50 inline-flex items-center gap-2"
                          >
                            <X className="h-4 w-4" />
                            Refuser
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void decide(a.id, 'accept')}
                            className="h-10 px-4 rounded-xl bg-brand-primary text-sm font-semibold text-[#101010] hover:bg-brand-primary/90 disabled:opacity-50 inline-flex items-center gap-2"
                          >
                            <Check className="h-4 w-4" />
                            Accepter
                          </button>
                        </div>
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
