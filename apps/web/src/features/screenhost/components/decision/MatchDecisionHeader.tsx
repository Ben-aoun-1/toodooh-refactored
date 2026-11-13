import { X } from 'lucide-react';

import {
  matchDateLabel,
  matchKickoffLabel,
  matchTeams,
} from '@/features/screenhost/lib/match-decision';
import type { PendingEventMatch } from '@/features/screenhost/services/screenhost-event-matches.service';

/** The mockup's ball, in brand ink. */
function Ball() {
  return (
    <svg
      viewBox="0 0 64 64"
      aria-hidden="true"
      className="absolute bottom-3.5 right-16 z-[1] h-11 w-11 animate-[spin_14s_linear_infinite] drop-shadow-md"
    >
      <circle cx="32" cy="32" r="30" className="fill-white stroke-brand-deep" strokeWidth="2" />
      <path d="M32 18l10 7-4 12H26l-4-12z" className="fill-brand-deep" />
      <path
        d="M32 18V4M42 25l13-4M38 37l8 12M26 37l-8 12M22 25L9 21"
        className="fill-none stroke-brand-deep"
        strokeWidth="2"
      />
    </svg>
  );
}

/**
 * Mariem 05/11 — the « Soir de match » popup's head (mockup Toodooh_Notif_Match_Host): a pitch
 * band with the badge and the pending status, then « Équipe A VS Équipe B », the day and the
 * kick-off (Tunis), and the venue — a fleet owner answers venue by venue.
 */
export default function MatchDecisionHeader({
  match,
  onClose,
}: {
  match: PendingEventMatch | undefined;
  onClose: () => void;
}) {
  const teams = match ? matchTeams(match.match_name) : null;
  return (
    <header>
      <div className="relative h-[118px] overflow-hidden bg-[repeating-linear-gradient(90deg,theme(colors.emerald.700)_0_44px,theme(colors.emerald.600)_44px_88px)] px-5 py-4 text-white">
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-3 inset-y-2.5 rounded border border-white/35"
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute bottom-2.5 left-1/2 top-2.5 border-l border-white/35"
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-1/2 top-1/2 h-[70px] w-[70px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/35"
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-brand-deep/60"
        />
        <div className="relative z-[1] flex items-start justify-between">
          <div className="flex flex-wrap gap-1.5">
            <span className="inline-flex items-center rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-brand-deep">
              ⚽ Soir de match
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-orange-200 bg-orange-50 px-2.5 py-1 text-[11px] font-semibold text-orange-600">
              <span className="h-1.5 w-1.5 rounded-full bg-orange-500" />
              En attente
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="flex h-[30px] w-[30px] items-center justify-center rounded-full bg-white/20 text-white hover:bg-white/30"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <Ball />
      </div>

      <div className="border-b border-[#EBEBEB] px-5 pb-3 pt-4">
        <h2
          id="match-decision-title"
          className="flex flex-wrap items-center gap-2.5 text-lg font-semibold text-[#171717]"
        >
          {teams ? (
            <>
              {teams[0]}
              <em className="rounded bg-brand-deep px-1.5 py-0.5 text-[10px] font-semibold not-italic text-white">
                VS
              </em>
              {teams[1]}
            </>
          ) : (
            (match?.match_name ?? 'Soir de match')
          )}
        </h2>
        {match ? (
          <div className="mt-1.5 flex flex-wrap gap-x-3.5 gap-y-1 text-xs text-[#5C5C5C]">
            <span>
              📅 <b className="font-semibold text-[#171717]">{matchDateLabel(match.kickoff_at)}</b>
            </span>
            <span>
              ⏱ Coup d’envoi{' '}
              <b className="font-semibold text-[#171717]">{matchKickoffLabel(match.kickoff_at)}</b>
            </span>
            <span>
              📍 <b className="font-semibold text-[#171717]">{match.screenhost_name}</b>
            </span>
          </div>
        ) : null}
      </div>
    </header>
  );
}
