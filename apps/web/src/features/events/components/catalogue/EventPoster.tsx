import { useEventImageUrl } from '../../hooks/useEvents';
import {
  TBD_TEAM,
  crowdColor,
  dateLine,
  hourLabel,
  isMultiMatch,
  kickoffBadge,
  roundLine,
} from '../../lib/event-catalogue';
import type { EventItemView, TeamView } from '../../services/events.api';

import StadiumBackdrop from './StadiumBackdrop';

// EVT-CAT2 — the dark poster at the top of a catalogue card (Youssef's validated design, Toodooh
// fonts): the stadium backdrop, a colour stripe, the competition, the two sides — their logo or
// flag when the admin uploaded one, always their name — and the kickoff box; an evening of
// several matches lists them as rows. An event without matches (older rows, suggestions) shows
// its name. Ruling 2026-10-08: when the admin uploaded an affiche, the affiche IS the poster.

const SHADOW = '0 2px 14px rgba(0,0,0,.85), 0 0 2px rgba(0,0,0,.6)';

/** A deterministic seed from the event id (the same card always draws the same crowd). */
const seedOf = (id: string): number =>
  [...id].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7);

function TeamCrest({ team, size }: { team: TeamView; size: number }) {
  if (!team.logo_url) return null;
  return (
    <img
      src={team.logo_url}
      alt={team.is_national ? `Drapeau ${team.name}` : `Logo ${team.name}`}
      className="object-contain drop-shadow-[0_8px_18px_rgba(0,0,0,.45)]"
      style={{ width: size, height: size }}
    />
  );
}

function ColourStripe({ home, away }: { home: TeamView; away: TeamView }) {
  return (
    <div className="absolute inset-x-0 top-0 z-10 flex h-1" aria-hidden="true">
      {[home.color_main, home.color_second, away.color_second, away.color_main].map((c, i) => (
        <span key={i} className="flex-1" style={{ background: c }} />
      ))}
    </div>
  );
}

function clubFont(name: string, base: number): number {
  return name.length > 16 ? base - 6 : name.length > 11 ? base - 3 : base;
}

interface EventPosterProps {
  event: EventItemView;
  variant?: 'card' | 'hero';
}

export default function EventPoster({ event, variant = 'card' }: EventPosterProps) {
  const matches = event.matches ?? [];
  const hero = variant === 'hero';
  const seed = seedOf(event.id);
  const badge = kickoffBadge(event);
  const { data: affiche } = useEventImageUrl(event.id, event.has_image);

  if (event.has_image) {
    return (
      <div
        className={`relative overflow-hidden bg-[#03060F] ${hero ? 'min-h-[400px]' : 'h-[228px]'}`}
      >
        {affiche?.url && (
          <img
            src={affiche.url}
            alt={`Affiche ${event.name}`}
            className="absolute inset-0 h-full w-full object-cover"
          />
        )}
      </div>
    );
  }

  if (isMultiMatch(event)) {
    const first = matches[0];
    const last = matches[matches.length - 1];
    return (
      <div className="relative flex min-h-[228px] flex-col gap-2 overflow-hidden bg-[#03060F] px-3.5 pb-4 pt-[18px] text-white">
        <StadiumBackdrop
          left={crowdColor(first?.home ?? null)}
          right={crowdColor(last?.away ?? null)}
          seed={seed}
          mixed
        />
        <div className="relative z-10 mb-1 px-10 text-center">
          <div
            className="text-[19px] font-extrabold uppercase tracking-wide"
            style={{ textShadow: SHADOW }}
          >
            {event.name}
          </div>
          <div className="mt-0.5 text-xs font-semibold tracking-wide text-white/90">
            {dateLine(event)}
            {badge ? `, ${badge}` : ''}
          </div>
        </div>
        {matches.map((m) => {
          const away = m.away ?? TBD_TEAM;
          return (
            <div
              key={m.position}
              className="relative z-10 grid grid-cols-[minmax(0,1fr)_24px_minmax(0,1fr)] items-center gap-2 rounded-[10px] border border-white/15 bg-[#03060F]/60 px-2.5 py-[7px] backdrop-blur-[3px]"
            >
              <span className="flex min-w-0 items-center gap-2 text-[13px] font-semibold leading-tight text-white">
                <TeamCrest team={m.home} size={22} />
                <span className="truncate text-white">{m.home.name}</span>
              </span>
              <span className="text-center text-[10.5px] font-semibold text-white/50">VS</span>
              <span className="flex min-w-0 items-center justify-end gap-2 text-right text-[13px] font-semibold leading-tight text-white">
                <span className="truncate text-white">{away.name}</span>
                <TeamCrest team={away} size={22} />
              </span>
            </div>
          );
        })}
      </div>
    );
  }

  const m = matches[0];
  const home = m?.home ?? null;
  const away = m ? (m.away ?? TBD_TEAM) : null;
  const base = hero ? 40 : 25;
  return (
    <div
      className={`relative flex flex-col justify-between overflow-hidden bg-[#03060F] text-white ${
        hero ? 'min-h-[400px] px-6 pb-6 pt-7' : 'h-[228px] px-3.5 pb-4 pt-[18px]'
      }`}
    >
      <StadiumBackdrop left={crowdColor(home)} right={crowdColor(away)} seed={seed} />
      {home && away && <ColourStripe home={home} away={away} />}
      <div
        className={`relative z-10 text-center font-semibold tracking-wide text-white/90 ${hero ? 'text-[13px]' : 'text-xs'}`}
      >
        {roundLine(event) ?? ''}
      </div>
      {home && away ? (
        <div
          className={`relative z-10 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center ${hero ? 'gap-4' : 'gap-2'}`}
        >
          {[home, away].map((team, i) => (
            <div
              key={team.id + String(i)}
              className={`flex min-w-0 flex-col items-center text-center ${hero ? 'gap-4' : 'gap-2.5'} ${i === 1 ? 'col-start-3' : ''}`}
            >
              <TeamCrest team={team} size={hero ? 124 : 64} />
              <span
                className="break-words font-extrabold uppercase leading-none tracking-wide text-white"
                style={{
                  fontSize: clubFont(team.name, team.is_national ? base - 6 : base),
                  textShadow: SHADOW,
                }}
              >
                {team.name}
              </span>
            </div>
          ))}
          <div className="col-start-2 row-start-1 flex flex-col items-center gap-0.5 rounded-[10px] border border-white/15 bg-[#03060F]/60 px-2.5 py-1.5 backdrop-blur-[3px]">
            {hero ? (
              <span className="text-[13px] font-semibold tracking-widest text-white/85">VS</span>
            ) : badge ? (
              <span
                className="text-2xl font-extrabold leading-none text-white"
                style={{ textShadow: SHADOW }}
              >
                {badge}
              </span>
            ) : (
              <>
                <span className="text-[10.5px] font-semibold tracking-widest text-white/85">
                  HORAIRE
                </span>
                <span className="text-[10.5px] font-semibold tracking-widest text-white/85">
                  À CONFIRMER
                </span>
              </>
            )}
          </div>
        </div>
      ) : (
        <div
          className="relative z-10 px-4 text-center text-2xl font-extrabold uppercase leading-tight"
          style={{ textShadow: SHADOW }}
        >
          {event.name}
          {badge && (
            <div className="mt-2 text-base font-bold normal-case">
              {hourLabel(event.kickoff_at)}
            </div>
          )}
        </div>
      )}
      <div className="relative z-10 text-center text-xs font-medium text-white/65">
        {dateLine(event)}
        {hero && event.stadium ? `, ${event.stadium}` : ''}
      </div>
    </div>
  );
}
