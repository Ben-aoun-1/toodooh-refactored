import CreativePreviewTile from '@/features/campaigns/pages/new-campaign/CreativePreviewTile';
import { formatEventDate, formatEventHours } from '@/features/events/lib/event-display';
import DecisionSection, {
  DecisionChip,
} from '@/features/screenhost/components/decision/DecisionSection';
import { useEventAllocationCreativeUrl } from '@/features/screenhost/hooks/useScreenhostEventAllocations';
import {
  EVENT_PERIODE_LINE,
  type PendingEventAllocation,
} from '@/features/screenhost/services/screenhost-event-allocations.service';

/**
 * Ruling 4A — the event proposal in the same popup: the match's date, hours and window take the
 * place of type / catégories / zones. `proposals` = the owner's pending rows for this event (one
 * per venue); they share the match and the spot.
 */
export default function EventDecisionDetails({
  proposals,
}: {
  proposals: readonly PendingEventAllocation[];
}) {
  const head = proposals[0];
  const spot = useEventAllocationCreativeUrl(head?.id ?? '', Boolean(head?.creative));
  if (!head) return null;
  const blocs = proposals.reduce((sum, p) => sum + p.blocs_count, 0);

  return (
    <>
      <DecisionSection label="Type">
        <div className="flex flex-wrap gap-2">
          <DecisionChip>Événement</DecisionChip>
        </div>
      </DecisionSection>

      <DecisionSection label="Période">
        <div className="flex flex-wrap justify-between gap-3 text-xs text-[#171717]">
          <span>
            <strong className="font-medium">Date:</strong> {formatEventDate(head.kickoff_at)}
          </span>
          <span>
            <strong className="font-medium">Horaires:</strong>{' '}
            {formatEventHours(head.kickoff_at, head.ends_at)}
          </span>
        </div>
        <p className="text-xs text-[#5C5C5C]">{EVENT_PERIODE_LINE}</p>
      </DecisionSection>

      <DecisionSection label="Établissement(s)">
        <div className="flex flex-wrap gap-2">
          {proposals.map((p) => (
            <DecisionChip key={p.id}>{p.screenhost_name}</DecisionChip>
          ))}
        </div>
        <p className="text-xs text-[#171717]">
          <strong className="font-medium">Blocs:</strong> {blocs}
        </p>
      </DecisionSection>

      <DecisionSection label="Spot">
        {head.creative ? (
          spot.isError ? (
            <p className="text-sm text-[#FB3748]">
              Impossible de charger le spot. Veuillez réessayer.
            </p>
          ) : (
            <CreativePreviewTile
              creativeType={head.creative.kind}
              title={head.match_name}
              durationSeconds={head.creative.duration_seconds}
              url={spot.url}
              isLoading={spot.isLoading}
            />
          )
        ) : (
          <div className="flex aspect-video items-center justify-center rounded-xl border border-[#EBEBEB] text-sm text-[#A3A3A3]">
            Aucun spot
          </div>
        )}
      </DecisionSection>
    </>
  );
}
