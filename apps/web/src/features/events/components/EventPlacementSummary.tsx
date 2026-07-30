import { useQuery } from '@tanstack/react-query';

import { campaignsKeys } from '@/features/campaigns/hooks/queryKeys';
import { apiClient } from '@/lib/api-client';

// EV4 — the positioning's placement summary (GET /api/campaigns/:id/event-allocations):
// N établissements, impressions prévues, one line per venue. Empty until the validation
// dispatches; the SAME read feeds the Consulter drawer.
export interface EventPlacementLine {
  id: string;
  screenhost_name: string;
  blocs_count: number;
  impressions_total: number;
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

const STATUT_LABELS: Record<string, string> = {
  EN_ATTENTE: 'En attente',
  ACCEPTE: 'Accepté',
  REFUSE: 'Refusé',
};
const STATUT_CLASSES: Record<string, string> = {
  EN_ATTENTE: 'bg-amber-50 text-amber-700',
  ACCEPTE: 'bg-green-50 text-green-700',
  REFUSE: 'bg-gray-100 text-gray-500',
};

/**
 * EV4/EV5 — the Consulter drawer's placement block for a POSITIONING: totals + per-venue lines,
 * and once the window closed, the SETTLEMENT summary (livré / manqué per venue + the refund).
 * Renders nothing while undispatched (a draft/carted positioning has no placement yet — silence
 * beats a fake zero).
 */
export default function EventPlacementSummary({ campaignId }: { campaignId: string }) {
  const { data } = useEventPlacement(campaignId);
  if (!data || data.count === 0) return null;
  const settlement = data.settlement;

  return (
    <div className="space-y-2">
      <p className="text-sm font-semibold text-[#171717]">
        {data.count} établissement{data.count > 1 ? 's' : ''} ·{' '}
        {data.impressions_total.toLocaleString('fr-FR')} impressions prévues
      </p>
      {settlement && (
        <div className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-xs">
          <p className="font-semibold text-[#171717]">Diffusion terminée</p>
          <p className="mt-0.5 text-[#5C5C5C]">
            Diffusé : {settlement.delivered_tnd.toLocaleString('fr-FR')} TND
            {settlement.refund_tnd > 0 ? (
              <>
                {' · '}
                <span className="font-medium text-amber-700">
                  Remboursé : {settlement.refund_tnd.toLocaleString('fr-FR')} TND
                </span>
              </>
            ) : (
              ' · diffusion intégralement assurée'
            )}
          </p>
        </div>
      )}
      <ul className="space-y-1.5">
        {data.allocations.map((line) => (
          <li
            key={line.id}
            className="flex items-center justify-between gap-2 rounded-lg border border-gray-100 bg-white px-3 py-2 text-xs"
          >
            <span className="min-w-0 truncate font-medium text-[#171717]">
              {line.screenhost_name}
            </span>
            <span className="shrink-0 text-[#7A7A7A]">
              {/* EV5 — once settled, the line speaks livré/manqué instead of the plan alone. */}
              {line.blocs_delivered === null
                ? `${line.blocs_count} bloc${line.blocs_count > 1 ? 's' : ''} · ${line.impressions_total.toLocaleString('fr-FR')} imp.`
                : `${line.blocs_delivered}/${line.blocs_count} bloc${line.blocs_count > 1 ? 's' : ''} diffusé${line.blocs_delivered > 1 ? 's' : ''}${
                    line.refund_tnd && line.refund_tnd > 0
                      ? ` · ${line.refund_tnd.toLocaleString('fr-FR')} TND remboursés`
                      : ''
                  }${line.attestation_negated ? ' · non respecté' : ''}`}
            </span>
            <span
              className={`shrink-0 rounded px-2 py-0.5 font-medium ${STATUT_CLASSES[line.statut] ?? 'bg-gray-100 text-gray-600'}`}
            >
              {STATUT_LABELS[line.statut] ?? line.statut}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
