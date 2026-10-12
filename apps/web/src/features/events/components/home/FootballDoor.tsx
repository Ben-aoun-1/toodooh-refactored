import { Link } from 'react-router-dom';

import { EVENTS_PATHS, type FootballDoorData } from '../../lib/events-home';
import FootballScene from '../scenes/FootballScene';

import DoorArrow from './DoorArrow';

/**
 * The « Football » door of the Événements home (Youssef's design): the stadium scene, the
 * catalogue's count and months, and its three featured fixtures — all live from the catalogue.
 */
export default function FootballDoor({ data }: { data: FootballDoorData }) {
  return (
    <Link
      to={EVENTS_PATHS.football}
      aria-label="Football, voir les affiches"
      className="group relative flex min-h-[460px] flex-col justify-end overflow-hidden rounded-3xl bg-[#03060F] text-white shadow-[0_1px_2px_rgba(13,43,31,.06),0_24px_48px_-24px_rgba(3,6,15,.55)] transition-transform hover:-translate-y-1 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-4 focus-visible:outline-[#1D9E75] md:min-h-[560px]"
    >
      <div className="absolute inset-0 transition-transform duration-500 group-hover:scale-[1.03]">
        <FootballScene />
      </div>
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_75%_at_0%_100%,rgba(2,4,11,.88)_0%,rgba(2,4,11,.55)_45%,rgba(2,4,11,0)_75%)]" />
      <div className="relative z-[1] flex flex-col gap-3.5 p-6 md:p-8">
        {data.kicker && (
          <span className="self-start rounded-full border border-white/20 bg-[#03060F]/55 px-3 py-1.5 text-[13px] font-semibold text-[#EAF5EF] backdrop-blur-[3px]">
            {data.kicker}
          </span>
        )}
        <span className="text-[clamp(44px,4.6vw,76px)] font-black uppercase leading-[.9] tracking-tight text-white drop-shadow-[0_6px_30px_rgba(0,0,0,.7)]">
          Football
        </span>
        {data.fixtures.length > 0 && (
          <div className="flex max-w-[400px] flex-col rounded-[14px] border border-white/15 bg-[#02040B]/55 p-2.5 backdrop-blur-[4px]">
            {data.fixtures.map((f, i) => (
              <div
                key={f.id}
                className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2.5 px-1.5 py-1.5 ${i > 0 ? 'border-t border-white/10' : ''}`}
              >
                <span className="truncate text-sm font-semibold text-white">{f.name}</span>
                <span className="font-mono text-[12.5px] text-brand-primary">{f.date}</span>
              </div>
            ))}
          </div>
        )}
        <DoorArrow label="Voir les affiches football" />
      </div>
    </Link>
  );
}
