import { Calendar, Radio } from 'lucide-react';

import {
  STATUT_LABELS,
  WINDOW_LINE,
  formatEventDate,
  formatEventHours,
} from '../../lib/event-display';
import { kickoffClock } from '../../lib/positioning-display';
import { SUGGESTED_MATCH_BADGE, suggestedPeriodLine } from '../../lib/suggest-match';
import type { EventItemView } from '../../services/events.api';

import TicketShell from './TicketShell';

interface MatchTicketProps {
  /** The positioned match; null while the catalogue loads (or the row aged out of it). */
  event: EventItemView | null;
  /** The positioning row's name — the fallback identity when the event is not loadable. */
  campaignName: string;
}

/**
 * EV3 — the match récap pinned on top of every step, drawn as the mockup's ticket: name, date |
 * horaire (Tunis), the ± 1 h window line, and the stub with the derived status and the kickoff.
 * The window is always the API's; without the event row the ticket falls back to the
 * positioning's snapshotted name.
 */
export default function MatchTicket({ event, campaignName }: MatchTicketProps) {
  const stub = event ? (
    <>
      <span className="rounded bg-pitch-ink px-2 py-0.5 text-xs font-medium text-brand-primary">
        {STATUT_LABELS[event.statut]}
      </span>
      <span className="text-3xl font-semibold tracking-wide text-pitch-ink">
        {event.time_tbc ? 'À confirmer' : kickoffClock(event.kickoff_at)}
      </span>
      <span className="text-xs uppercase tracking-[0.06em] text-pitch-deep">Coup d’envoi</span>
    </>
  ) : undefined;

  return (
    <TicketShell stub={stub}>
      <p className="flex flex-wrap items-center gap-2 text-xs font-medium uppercase tracking-[0.04em] text-brand-primary">
        Positionnement sur événement
        {event?.source === 'suggested' && (
          <span className="rounded-md bg-brand-primary px-2 py-0.5 text-[10px] tracking-wider text-pitch-ink">
            {SUGGESTED_MATCH_BADGE}
          </span>
        )}
      </p>
      <h2 className="mt-1 text-xl font-semibold text-white">{event?.name ?? campaignName}</h2>
      {event && (
        <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="flex items-center gap-1.5 text-sm text-pitch-wash">
            <Calendar className="h-4 w-4 shrink-0" aria-hidden="true" />
            {formatEventDate(event.kickoff_at)}
          </span>
          <span aria-hidden="true" className="h-3.5 w-px bg-white/25" />
          <span className="text-sm text-pitch-wash">
            {formatEventHours(event.kickoff_at, event.ends_at)}
          </span>
          <span aria-hidden="true" className="h-3.5 w-px bg-white/25" />
          <span className="flex items-center gap-1.5 text-sm text-pitch-wash">
            <Radio className="h-4 w-4 shrink-0" aria-hidden="true" />
            {WINDOW_LINE}
          </span>
        </div>
      )}
      {/* SUGG-2 — a suggested match's period is the screencaster's own (Youssef's v9 mockup). */}
      {event?.source === 'suggested' && (
        <p className="mt-3 inline-block rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold text-brand-primary">
          {suggestedPeriodLine(event)}
        </p>
      )}
    </TicketShell>
  );
}
