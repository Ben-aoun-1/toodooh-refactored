import { useQuery } from '@tanstack/react-query';

import { campaignsKeys } from '@/features/campaigns/hooks/queryKeys';
import { eventPlacementPrevues } from '@/features/campaigns/lib/campaign-impressions';
import { apiClient } from '@/lib/api-client';
import { tndLabel } from '@/lib/money';

import { placementTotals } from '../lib/placement-totals';

// EV4 — the positioning's placement summary (GET /api/campaigns/:id/event-allocations):
// totals (no venue names — operator 2026-10-09). Empty until the validation dispatches.
export interface EventPlacementLine {
  id: string;
  blocs_count: number;
  impressions_total: number;
  /** IMP-FACT1 — the venue's chargeable (billable) share; absent on an older api. */
  impressions_facturables?: number | null;
  montant_tnd: number;
  statut: string;
  /** EV5 — null until the positioning settles; then the per-venue livré/manqué verdict. */
  blocs_delivered: number | null;
  delivered_tnd: number | null;
  refund_tnd: number | null;
  attestation_negated: boolean | null;
}

/** EV5 — present once the window closed and the monitor settled the positioning. */
export interface EventSettlementView {
  settled_at: string;
  delivered_tnd: number;
  refund_tnd: number;
}

export interface EventPlacementView {
  count: number;
  impressions_total: number;
  /** IMP-FACT1 — the positioning's billable objective; absent on an older api. */
  impressions_objectif?: number | null;
  montant_total_tnd: number;
  allocations: EventPlacementLine[];
  settlement: EventSettlementView | null;
}

export function useEventPlacement(campaignId: string | null) {
  return useQuery({
    queryKey: [...campaignsKeys.all, 'eventPlacement', campaignId ?? ''] as const,
    queryFn: () => apiClient.get<EventPlacementView>(`/campaigns/${campaignId}/event-allocations`),
    enabled: Boolean(campaignId),
  });
}

/**
 * EV4/EV5 — the Consulter drawer's placement block for a POSITIONING. Operator 2026-10-09 (Q4A):
 * TOTALS only — never a venue's name nor a per-venue list — and once the window closed, the
 * SETTLEMENT summary (diffusé + the refund). Renders nothing while undispatched (a draft/carted
 * positioning has no placement yet — silence beats a fake zero).
 */
export default function EventPlacementSummary({ campaignId }: { campaignId: string }) {
  const { data } = useEventPlacement(campaignId);
  if (!data || data.count === 0) return null;
  const settlement = data.settlement;
  const totals = placementTotals(data.allocations);

  return (
    <div className="space-y-2">
      <p className="text-sm font-semibold text-[#171717]">
        {totals.venues} établissement{totals.venues > 1 ? 's' : ''} · {totals.minutes} minute
        {totals.minutes > 1 ? 's' : ''} · {eventPlacementPrevues(data).toLocaleString('fr-FR')}{' '}
        impressions prévues
      </p>
      <p className="text-xs text-[#5C5C5C]">
        Montant placé : {tndLabel(totals.montantTnd)}
        {totals.pending > 0 &&
          ` · ${totals.accepted} accepté${totals.accepted > 1 ? 's' : ''}, ${totals.pending} en attente de réponse`}
      </p>
      {settlement && (
        <div className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-xs">
          <p className="font-semibold text-[#171717]">Diffusion terminée</p>
          <p className="mt-0.5 text-[#5C5C5C]">
            Diffusé : {tndLabel(settlement.delivered_tnd)}
            {settlement.refund_tnd > 0 ? (
              <>
                {' · '}
                <span className="font-medium text-amber-700">
                  Remboursé : {tndLabel(settlement.refund_tnd)}
                </span>
              </>
            ) : (
              ' · diffusion intégralement assurée'
            )}
          </p>
        </div>
      )}
    </div>
  );
}
