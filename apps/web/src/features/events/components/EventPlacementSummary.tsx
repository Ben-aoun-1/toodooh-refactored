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
}

export interface EventPlacementView {
  count: number;
  impressions_total: number;
  montant_total_tnd: number;
  allocations: EventPlacementLine[];
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
 * EV4 — the Consulter drawer's placement block for a POSITIONING: totals + per-venue lines from
 * event_allocations. Renders nothing while undispatched (a draft/carted positioning has no
 * placement yet — silence beats a fake zero).
 */
export default function EventPlacementSummary({ campaignId }: { campaignId: string }) {
  const { data } = useEventPlacement(campaignId);
  if (!data || data.count === 0) return null;

  return (
    <div className="space-y-2">
      <p className="text-sm font-semibold text-[#171717]">
        {data.count} établissement{data.count > 1 ? 's' : ''} ·{' '}
        {data.impressions_total.toLocaleString('fr-FR')} impressions prévues
      </p>
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
              {line.blocs_count} bloc{line.blocs_count > 1 ? 's' : ''} ·{' '}
              {line.impressions_total.toLocaleString('fr-FR')} imp.
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
