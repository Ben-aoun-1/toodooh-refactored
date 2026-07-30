import { CalendarClock, Check, Play, Radio, X } from 'lucide-react';
import { useState } from 'react';

import CreativePreviewTile from '@/features/campaigns/pages/new-campaign/CreativePreviewTile';
import { formatEventDate, formatEventHours } from '@/features/events/lib/event-display';
import { useEventAllocationCreativeUrl } from '@/features/screenhost/hooks/useScreenhostEventAllocations';
import {
  EVENT_PERIODE_LINE,
  EVENT_REFUSED_STATE_DETAIL,
  EVENT_REFUSED_STATE_LABEL,
  type PendingEventAllocation,
} from '@/features/screenhost/services/screenhost-event-allocations.service';
import { htTtcLabel } from '@/lib/money';

interface EventAllocationCardProps {
  proposal: PendingEventAllocation;
  refused: boolean;
  busy: boolean;
  onAccept: () => void;
  onRefuse: () => void;
}

/**
 * EV4 (§11.1) — one owner-facing EVENT proposal: the match, the période « 1 h avant · match ·
 * 1 h après » with the kickoff date/hours, the montant HT (TTC), blocs + impressions, and the
 * spot (video OR image) behind a lazy presign. Accept/refuse mirror the campaign card's idiom;
 * a confirmed refusal flips to « Refus enregistré » instead of vanishing.
 */
export default function EventAllocationCard({
  proposal,
  refused,
  busy,
  onAccept,
  onRefuse,
}: EventAllocationCardProps) {
  const [expanded, setExpanded] = useState(false);
  const { url, isLoading, isError } = useEventAllocationCreativeUrl(
    proposal.id,
    expanded && proposal.creative !== null,
  );

  return (
    <li className="rounded-2xl border border-[#EBEBEB] bg-white px-5 py-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <div className="mt-0.5 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full border border-brand-primary text-[#2A7A47]">
            <CalendarClock className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[#2A7A47]">
              Montant : {htTtcLabel(proposal.montant_tnd)}
            </p>
            <p className="flex items-center gap-2 truncate text-base font-medium text-[#171717]">
              {proposal.match_name}
              <span className="inline-flex shrink-0 rounded bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-700">
                Événement
              </span>
            </p>
            <p className="truncate text-sm text-[#5C5C5C]">{proposal.screenhost_name}</p>
            <p className="mt-0.5 text-xs text-[#7A7A7A]">
              {formatEventDate(proposal.kickoff_at)} ·{' '}
              {formatEventHours(proposal.kickoff_at, proposal.ends_at)} · {proposal.blocs_count}{' '}
              bloc{proposal.blocs_count > 1 ? 's' : ''} ·{' '}
              {proposal.impressions_total.toLocaleString('fr-FR')} impressions
            </p>
            <p className="mt-0.5 flex items-center gap-1.5 text-xs text-[#7A7A7A]">
              <Radio className="h-3.5 w-3.5 shrink-0" />
              Période : {EVENT_PERIODE_LINE}
            </p>
            {proposal.creative && (
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-brand-deep hover:underline"
              >
                <Play className="h-3.5 w-3.5" />
                {expanded ? 'Masquer le spot' : 'Voir le spot'}
              </button>
            )}
          </div>
        </div>
        {refused ? (
          <div className="flex flex-shrink-0 flex-col items-end gap-1 text-right">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-3 py-1.5 text-sm font-medium text-[#5C5C5C]">
              <X className="h-4 w-4" />
              {EVENT_REFUSED_STATE_LABEL}
            </span>
            <span className="text-xs text-[#7A7A7A]">{EVENT_REFUSED_STATE_DETAIL}</span>
          </div>
        ) : (
          <div className="flex flex-shrink-0 items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={onRefuse}
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 text-sm font-medium text-[#5C5C5C] hover:bg-gray-50 disabled:opacity-50"
            >
              <X className="h-4 w-4" />
              Refuser
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={onAccept}
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-brand-primary px-4 text-sm font-semibold text-[#101010] hover:bg-brand-primary/90 disabled:opacity-50"
            >
              <Check className="h-4 w-4" />
              Accepter
            </button>
          </div>
        )}
      </div>
      {expanded && proposal.creative && (
        <div className="mt-3 pl-[3.25rem]">
          {isError ? (
            <p className="text-sm text-[#FB3748]">
              Impossible de charger le spot. Veuillez réessayer.
            </p>
          ) : (
            <div className="max-w-md">
              <CreativePreviewTile
                creativeType={proposal.creative.kind}
                title={proposal.match_name}
                durationSeconds={proposal.creative.duration_seconds}
                url={url}
                isLoading={isLoading}
              />
            </div>
          )}
        </div>
      )}
    </li>
  );
}
