import { CalendarDays, Clock } from 'lucide-react';

import { COMING_SOON_LABEL, RAMADAN_OFFER } from '../../lib/events-home';
import RamadanScene from '../scenes/RamadanScene';

const chip =
  'inline-flex items-center gap-1.5 rounded-full border border-[#FFD68C]/40 bg-[#060A22]/60 px-3 py-1.5 text-[13px] font-semibold text-[#FFF3DA] backdrop-blur-[3px]';

/**
 * « Soirées du Ramadan 2027 » — the seasonal offer card of the Ramadan page (Youssef's design,
 * .card.rama), shown but NOT sold yet (operator 2026-10-12): the impressions box is hidden (Q4 A)
 * and « Je me positionne » is a disabled « Bientôt disponible ». The same card layout as the
 * catalogue's hero, so it reads as one family.
 */
export default function RamadanOfferCard() {
  return (
    <article className="flex flex-row flex-wrap overflow-hidden rounded-[18px] border border-[#E1EAE5] bg-white shadow-[0_1px_2px_rgba(13,43,31,.04),0_8px_24px_-16px_rgba(13,43,31,.18)]">
      <div className="relative flex min-h-[420px] min-w-0 flex-[2_1_520px] flex-col justify-between overflow-hidden bg-[#060A22] px-7 py-[26px]">
        <RamadanScene />
        <div className="relative">
          <span className={chip}>{RAMADAN_OFFER.chip}</span>
        </div>
        <div className="relative flex max-w-[440px] flex-col gap-1.5">
          <span
            lang="ar"
            dir="rtl"
            className="self-start text-[26px] font-bold text-[#FFD27A] drop-shadow-[0_2px_14px_rgba(0,0,0,.6)]"
          >
            {RAMADAN_OFFER.arabic}
          </span>
          <span className="text-[52px] font-semibold italic leading-[.95] text-[#FFF3DA] drop-shadow-[0_4px_24px_rgba(0,0,0,.55)] md:text-[80px]">
            {RAMADAN_OFFER.title}
          </span>
          <span className="text-[22px] font-extrabold tracking-[.08em] text-[#FFD27A]">
            {RAMADAN_OFFER.year}
          </span>
          <p className="mt-2.5 text-[15.5px] leading-normal text-[#F3E7D3] drop-shadow-[0_1px_10px_rgba(0,0,0,.7)]">
            {RAMADAN_OFFER.pitch}
          </p>
        </div>
        <div className="relative flex flex-wrap gap-2">
          <span className={chip}>
            <b className="font-mono font-medium text-[#FFD27A]">{RAMADAN_OFFER.nights}</b> soirées
          </span>
          <span className={chip}>
            Chaque soir de{' '}
            <b className="font-mono font-medium text-[#FFD27A]">{RAMADAN_OFFER.window.from}</b> à{' '}
            <b className="font-mono font-medium text-[#FFD27A]">{RAMADAN_OFFER.window.to}</b>
          </span>
          <span className={chip}>{RAMADAN_OFFER.shortRange}</span>
        </div>
      </div>
      <div className="flex flex-1 basis-[320px] flex-col gap-5 p-7">
        <div className="flex flex-col gap-1">
          <p className="text-[16.5px] font-bold leading-snug text-[#0D2B1F]">
            {RAMADAN_OFFER.cardTitle}
          </p>
          <p className="text-[13.5px] text-[#4F6B60]">{RAMADAN_OFFER.cardRound}</p>
        </div>
        <div className="flex flex-col gap-1.5 text-[13.5px] text-[#0D2B1F]">
          <span className="flex items-start gap-2 text-[#0D2B1F]">
            <CalendarDays className="mt-px h-4 w-4 shrink-0 text-[#1D9E75]" aria-hidden="true" />
            {RAMADAN_OFFER.cardDates}
          </span>
          <span className="flex items-start gap-2 text-[#0D2B1F]">
            <Clock className="mt-px h-4 w-4 shrink-0 text-[#1D9E75]" aria-hidden="true" />
            {RAMADAN_OFFER.cardWindow}
          </span>
          <span className="self-start rounded-full bg-[#EEEFFE] px-2.5 py-0.5 text-xs font-semibold text-[#3B3FA8]">
            {RAMADAN_OFFER.cardBadge}
          </span>
        </div>
        <div className="mt-auto">
          <button
            type="button"
            disabled
            className="inline-flex min-h-[50px] w-full cursor-not-allowed items-center justify-center rounded-xl bg-[#E3EAE6] text-[15px] font-bold text-[#8AA197]"
          >
            {COMING_SOON_LABEL}
          </button>
        </div>
      </div>
    </article>
  );
}
