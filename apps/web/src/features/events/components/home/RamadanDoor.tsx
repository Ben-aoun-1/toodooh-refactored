import { Link } from 'react-router-dom';

import { COMING_SOON_LABEL, EVENTS_PATHS, RAMADAN_OFFER } from '../../lib/events-home';
import RamadanScene from '../scenes/RamadanScene';

import DoorArrow from './DoorArrow';

/**
 * The « Ramadan 2027 » door of the Événements home (Youssef's design). The offer is shown but not
 * sold yet (operator 2026-10-12): a « Bientôt disponible » chip rides with the design's own chips.
 */
export default function RamadanDoor() {
  return (
    <Link
      to={EVENTS_PATHS.ramadan}
      aria-label={`Ramadan ${RAMADAN_OFFER.year}, voir l’offre des ${RAMADAN_OFFER.nights} soirées (bientôt disponible)`}
      className="group relative flex min-h-[460px] flex-col justify-end overflow-hidden rounded-3xl bg-[#060A22] text-white shadow-[0_1px_2px_rgba(13,43,31,.06),0_24px_48px_-24px_rgba(3,6,15,.55)] transition-transform hover:-translate-y-1 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-4 focus-visible:outline-[#1D9E75] md:min-h-[560px]"
    >
      <div className="absolute inset-0 transition-transform duration-500 group-hover:scale-[1.03]">
        <RamadanScene />
      </div>
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(6,10,34,0)_34%,rgba(6,10,34,.55)_64%,rgba(6,10,34,.92)_100%)]" />
      <div className="relative z-[1] flex flex-col gap-3.5 p-6 md:p-8">
        <span className="self-start rounded-full border border-white/20 bg-[#03060F]/55 px-3 py-1.5 text-[13px] font-semibold text-[#EAF5EF] backdrop-blur-[3px]">
          {RAMADAN_OFFER.shortRange}
        </span>
        <span
          lang="ar"
          dir="rtl"
          className="self-start text-[26px] font-bold text-[#FFD27A] drop-shadow-[0_2px_14px_rgba(0,0,0,.6)]"
        >
          {RAMADAN_OFFER.arabic}
        </span>
        <span className="flex flex-wrap items-baseline gap-3.5">
          <span className="text-[clamp(44px,4.6vw,76px)] font-semibold italic leading-[.9] text-[#FFF3DA] drop-shadow-[0_4px_24px_rgba(0,0,0,.55)]">
            {RAMADAN_OFFER.title}
          </span>
          <span className="text-2xl font-extrabold tracking-[.08em] text-[#FFD27A]">
            {RAMADAN_OFFER.year}
          </span>
        </span>
        <div className="flex flex-wrap gap-2">
          <span className="rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-[13px] font-semibold text-white">
            {RAMADAN_OFFER.nights} soirées
          </span>
          <span className="rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-[13px] font-semibold text-white">
            Chaque soir de {RAMADAN_OFFER.window.from} à {RAMADAN_OFFER.window.to}
          </span>
          <span className="rounded-full border border-[#FFD27A]/50 bg-[#FFD27A]/15 px-3 py-1.5 text-[13px] font-semibold text-[#FFD27A]">
            {COMING_SOON_LABEL}
          </span>
        </div>
        <DoorArrow label={RAMADAN_OFFER.doorCta} />
      </div>
    </Link>
  );
}
