import { useMemo } from 'react';

import PageHeader from '@/components/PageHeader';

import FootballDoor from '../components/home/FootballDoor';
import RamadanDoor from '../components/home/RamadanDoor';
import MesEvenementsStrip from '../components/MesEvenementsStrip';
import { useEventsCatalogue } from '../hooks/useEvents';
import { footballDoorData } from '../lib/events-home';

/**
 * « Événements » — the section's home (Youssef's design, operator rulings 2026-10-12): two doors,
 * Football (the live catalogue) and Ramadan 2027 (coming soon), then « Mes Événements » (Q3 A).
 */
export default function EventsHome() {
  const { data: catalogue } = useEventsCatalogue();
  const football = useMemo(() => footballDoorData(catalogue ?? []), [catalogue]);

  return (
    <div className="w-full space-y-8 pb-12">
      <PageHeader
        title="Événements"
        subtitle="Profitez des pics d’audience des grands moments pour amplifier votre impact"
      />
      <div className="grid grid-cols-1 gap-7 lg:grid-cols-2">
        <FootballDoor data={football} />
        <RamadanDoor />
      </div>
      <MesEvenementsStrip />
    </div>
  );
}
