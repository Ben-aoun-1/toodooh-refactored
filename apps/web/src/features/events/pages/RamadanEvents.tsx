import PageHeader from '@/components/PageHeader';

import EventsCrumb from '../components/home/EventsCrumb';
import RamadanOfferCard from '../components/home/RamadanOfferCard';
import { RAMADAN_OFFER } from '../lib/events-home';

/**
 * « Ramadan 2027 » — the Ramadan universe of the Événements section (Youssef's design, #ramadan):
 * one seasonal offer, coming soon (operator 2026-10-12).
 */
export default function RamadanEvents() {
  return (
    <div className="w-full space-y-8 pb-12">
      <PageHeader
        title="Événements"
        subtitle="Profitez des pics d’audience des grands moments pour amplifier votre impact"
      />
      <EventsCrumb />
      <section className="flex flex-col gap-5">
        <div className="flex items-baseline gap-3.5 border-b border-[#E1EAE5] pb-2.5">
          <h2 className="text-[26px] font-bold tracking-tight text-[#0D2B1F]">
            {RAMADAN_OFFER.sectionTitle}
          </h2>
          <span className="font-mono text-[13px] text-[#4F6B60]">1 événement</span>
        </div>
        <RamadanOfferCard />
      </section>
    </div>
  );
}
